import {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

import {
	getCredentials,
	downloadFile,
	getFolders,
	getPdfFiles,
} from '../shared/GenericFunctions';

// ---------------------------------------------------------------------------
// Provider result shape
// ---------------------------------------------------------------------------

interface OcrResult {
	text: string;
	markdown: string;
	pages: Array<{ index: number; text: string; markdown: string }>;
	raw: unknown;
}

// ---------------------------------------------------------------------------
// Docling (docling-serve)
// ---------------------------------------------------------------------------

async function runDocling(
	buffer: Buffer,
	fileName: string,
	endpoint: string,
	apiPath: string,
): Promise<OcrResult> {
	const url = endpoint.replace(/\/$/, '') + apiPath;

	const formData = new FormData();
	formData.append('files', new Blob([buffer], { type: 'application/pdf' }), fileName);
	formData.append('options', JSON.stringify({ to_formats: ['md', 'text'] }));

	const response = await fetch(url, { method: 'POST', body: formData });

	if (!response.ok) {
		const errBody = await response.text().catch(() => '');
		throw new Error(`Docling ${response.status}: ${errBody.slice(0, 400)}`);
	}

	const raw = await response.json() as Record<string, unknown>;

	// docling-serve may return { documents: [...] } (batch) or { document: {...} }
	const docs = raw.documents as Record<string, unknown>[] | undefined;
	const doc: Record<string, unknown> = docs
		? (docs[0] ?? {})
		: ((raw.document as Record<string, unknown>) ?? raw);

	const markdown = String(doc.md_content ?? doc.markdown_content ?? doc.markdown ?? '');
	const text = String(doc.text_content ?? doc.text ?? markdown);

	return { text, markdown, pages: [], raw };
}

// ---------------------------------------------------------------------------
// Mistral OCR
// ---------------------------------------------------------------------------

async function runMistral(
	buffer: Buffer,
	apiKey: string,
	model: string,
): Promise<OcrResult> {
	const base64 = buffer.toString('base64');

	const response = await fetch('https://api.mistral.ai/v1/ocr', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			model,
			document: {
				type: 'document_url',
				document_url: `data:application/pdf;base64,${base64}`,
			},
		}),
	});

	if (!response.ok) {
		const errBody = await response.text().catch(() => '');
		throw new Error(`Mistral OCR ${response.status}: ${errBody.slice(0, 400)}`);
	}

	const raw = await response.json() as {
		pages?: Array<{ index: number; markdown: string }>;
		[key: string]: unknown;
	};

	const pages = (raw.pages ?? []).map(p => ({
		index: p.index,
		text: p.markdown,
		markdown: p.markdown,
	}));

	const markdown = pages.map(p => p.markdown).join('\n\n---\n\n');

	return { text: markdown, markdown, pages, raw };
}

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

export class NextCloudOcr implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'NextCloud OCR',
		name: 'nextCloudOcr',
		icon: 'file:nextcloud.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["ocrProvider"]}}',
		description: 'Extrait le texte de fichiers PDF stockés sur Nextcloud via un moteur OCR (Docling, Mistral, …)',
		defaults: { name: 'NextCloud OCR' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'nextCloudApi', required: true }],
		properties: [

			// ── File selection ────────────────────────────────────────────────
			{
				displayName: 'Depuis',
				name: 'filePathMode',
				type: 'options',
				options: [
					{ name: 'Depuis une liste', value: 'list' },
					{ name: 'Par chemin (expression)', value: 'path' },
				],
				default: 'list',
				description: 'Comment spécifier le fichier PDF source',
			},
			{
				displayName: 'Dossier',
				name: 'folderPath',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getFolders' },
				displayOptions: { show: { filePathMode: ['list'] } },
				default: '/',
				description: 'Filtrer la liste de fichiers par dossier',
			},
			{
				displayName: 'Fichier PDF',
				name: 'filePathFromList',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getPdfFiles',
					loadOptionsDependsOn: ['folderPath'],
				},
				displayOptions: { show: { filePathMode: ['list'] } },
				default: '',
				description: 'Fichier PDF dans le dossier sélectionné',
			},
			{
				displayName: 'Chemin du fichier PDF',
				name: 'filePath',
				type: 'string',
				default: '',
				placeholder: '/Documents/scan.pdf',
				displayOptions: { show: { filePathMode: ['path'] } },
				description: 'Chemin complet du fichier PDF sur Nextcloud. Supporte les expressions.',
			},

			// ── OCR Provider ──────────────────────────────────────────────────
			{
				displayName: 'Moteur OCR',
				name: 'ocrProvider',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Docling (local)',
						value: 'docling',
						description: 'Serveur Docling auto-hébergé via docling-serve',
					},
					{
						name: 'Mistral OCR',
						value: 'mistral',
						description: 'API cloud Mistral OCR (mistral-ocr-latest)',
					},
				],
				default: 'docling',
				description: 'Moteur OCR à utiliser pour extraire le texte',
			},

			// ── Docling settings ──────────────────────────────────────────────
			{
				displayName: 'URL du serveur Docling',
				name: 'doclingEndpoint',
				type: 'string',
				default: 'http://localhost:5001',
				placeholder: 'http://localhost:5001',
				displayOptions: { show: { ocrProvider: ['docling'] } },
				description: "URL de base du serveur docling-serve (sans slash final). Supporte les expressions.",
			},
			{
				displayName: 'Version API Docling',
				name: 'doclingApiPath',
				type: 'options',
				displayOptions: { show: { ocrProvider: ['docling'] } },
				options: [
					{
						name: '/v1alpha/convert/source  (docling-serve ≤ 0.4)',
						value: '/v1alpha/convert/source',
					},
					{
						name: '/v1/convert/source  (docling-serve ≥ 0.5)',
						value: '/v1/convert/source',
					},
					{
						name: 'Personnalisé',
						value: 'custom',
					},
				],
				default: '/v1alpha/convert/source',
				description: "Chemin de l'endpoint API. Ajuster selon la version de docling-serve installée.",
			},
			{
				displayName: 'Chemin API personnalisé',
				name: 'doclingApiPathCustom',
				type: 'string',
				default: '/v1alpha/convert/source',
				placeholder: '/v1alpha/convert/source',
				displayOptions: { show: { ocrProvider: ['docling'], doclingApiPath: ['custom'] } },
				description: "Chemin complet de l'endpoint Docling (ex: /api/ocr/convert)",
			},

			// ── Mistral settings ──────────────────────────────────────────────
			{
				displayName: 'Clé API Mistral',
				name: 'mistralApiKey',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				displayOptions: { show: { ocrProvider: ['mistral'] } },
				description: 'Clé API Mistral. Créer sur console.mistral.ai/api-keys',
			},
			{
				displayName: 'Modèle Mistral',
				name: 'mistralModel',
				type: 'string',
				default: 'mistral-ocr-latest',
				displayOptions: { show: { ocrProvider: ['mistral'] } },
				description: 'Identifiant du modèle OCR Mistral (ex: mistral-ocr-latest)',
			},

			// ── Output ────────────────────────────────────────────────────────
			{
				displayName: 'Inclure la réponse brute',
				name: 'includeRaw',
				type: 'boolean',
				default: false,
				description: "Ajouter la réponse complète du moteur OCR dans le champ 'raw' (utile pour le débogage)",
			},
		],
	};

	methods = {
		loadOptions: {
			async getFolders(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return getFolders(this);
			},
			async getPdfFiles(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return getPdfFiles(this);
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const creds = await getCredentials(this);

		for (let i = 0; i < items.length; i++) {
			try {
				// ── Resolve file path ──────────────────────────────────────────
				const filePathMode = this.getNodeParameter('filePathMode', i, 'list') as string;
				const filePath = filePathMode === 'list'
					? (this.getNodeParameter('filePathFromList', i, '') as string)
					: (this.getNodeParameter('filePath', i, '') as string);

				if (!filePath) {
					throw new NodeOperationError(this.getNode(), 'Aucun fichier PDF spécifié', { itemIndex: i });
				}

				const buffer = await downloadFile(this, creds, filePath);
				const fileName = filePath.split('/').pop() ?? 'document.pdf';
				const provider = this.getNodeParameter('ocrProvider', i, 'docling') as string;
				const includeRaw = this.getNodeParameter('includeRaw', i, false) as boolean;

				// ── Run OCR ────────────────────────────────────────────────────
				let result: OcrResult;

				if (provider === 'docling') {
					const endpoint = this.getNodeParameter('doclingEndpoint', i, 'http://localhost:5001') as string;
					const apiPathChoice = this.getNodeParameter('doclingApiPath', i, '/v1alpha/convert/source') as string;
					const apiPath = apiPathChoice === 'custom'
						? (this.getNodeParameter('doclingApiPathCustom', i, '') as string)
						: apiPathChoice;

					result = await runDocling(buffer, fileName, endpoint, apiPath);

				} else if (provider === 'mistral') {
					const apiKey = this.getNodeParameter('mistralApiKey', i, '') as string;
					if (!apiKey) {
						throw new NodeOperationError(this.getNode(), 'Clé API Mistral manquante', { itemIndex: i });
					}
					const model = this.getNodeParameter('mistralModel', i, 'mistral-ocr-latest') as string;

					result = await runMistral(buffer, apiKey, model);

				} else {
					throw new NodeOperationError(this.getNode(), `Moteur OCR inconnu : ${provider}`, { itemIndex: i });
				}

				// ── Build output ───────────────────────────────────────────────
				const output: IDataObject = {
					pdfPath: filePath,
					provider,
					text: result.text,
					markdown: result.markdown,
					pageCount: result.pages.length || null,
				};

				if (result.pages.length > 0) output.pages = result.pages as unknown as IDataObject[];
				if (includeRaw) output.raw = result.raw as IDataObject;

				returnData.push({ json: output });

			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: i });
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
