import {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeListSearchResult,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
	IDataObject,
} from 'n8n-workflow';

import {
	PDFDocument,
	PDFTextField,
	PDFCheckBox,
	PDFRadioGroup,
	PDFDropdown,
	PDFOptionList,
	PDFSignature,
	PDFButton,
} from 'pdf-lib';

import { PDFParse } from 'pdf-parse';

import {
	getCredentials,
	downloadFile,
	uploadFile,
	getFolders,
	getPdfFiles,
	searchPdfFiles,
	buildOutputPath,
} from '../shared/GenericFunctions';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toBool(value: unknown): boolean {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'number') return value !== 0;
	if (typeof value === 'string') {
		return ['true', 'yes', 'oui', '1', 'vrai', 'checked', 'on'].includes(value.toLowerCase().trim());
	}
	return Boolean(value);
}

interface PdfFieldInfo {
	name: string;
	type: string;
	value: unknown;
	options?: string[];
	required?: boolean;
	readOnly?: boolean;
}

async function extractPdfFields(buffer: Buffer): Promise<PdfFieldInfo[]> {
	const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
	const form = pdfDoc.getForm();
	const fields = form.getFields();
	const result: PdfFieldInfo[] = [];

	for (const field of fields) {
		const name = field.getName();
		try {
			if (field instanceof PDFTextField) {
				result.push({
					name,
					type: 'text',
					value: field.getText() ?? '',
					required: field.isRequired(),
					readOnly: field.isReadOnly(),
				});
			} else if (field instanceof PDFCheckBox) {
				result.push({
					name,
					type: 'checkbox',
					value: field.isChecked(),
					required: field.isRequired(),
					readOnly: field.isReadOnly(),
				});
			} else if (field instanceof PDFRadioGroup) {
				result.push({
					name,
					type: 'radio',
					value: field.getSelected() ?? null,
					options: field.getOptions(),
					required: field.isRequired(),
					readOnly: field.isReadOnly(),
				});
			} else if (field instanceof PDFDropdown) {
				const selected = field.getSelected();
				result.push({
					name,
					type: 'dropdown',
					value: selected.length > 0 ? selected[0] : null,
					options: field.getOptions(),
					required: field.isRequired(),
					readOnly: field.isReadOnly(),
				});
			} else if (field instanceof PDFOptionList) {
				result.push({
					name,
					type: 'optionList',
					value: field.getSelected(),
					options: field.getOptions(),
					required: field.isRequired(),
					readOnly: field.isReadOnly(),
				});
			} else if (field instanceof PDFSignature) {
				result.push({ name, type: 'signature', value: null, readOnly: true });
			} else if (field instanceof PDFButton) {
				result.push({ name, type: 'button', value: null, readOnly: true });
			} else {
				result.push({ name, type: 'unknown', value: null });
			}
		} catch {
			result.push({ name, type: 'error', value: null });
		}
	}

	return result;
}

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

export class NextCloudPdf implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'NextCloud PDF',
		name: 'nextCloudPdf',
		icon: 'file:nextcloud.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Lit et remplit les champs de formulaire (AcroForm) de PDFs stockés sur Nextcloud',
		defaults: { name: 'NextCloud PDF' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'nextCloudApi', required: true }],
		properties: [

			// ── Operation ────────────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Get Fields',
						value: 'getFields',
						description: 'Extrait tous les champs de formulaire AcroForm du PDF (PDFs interactifs non aplatis)',
						action: 'Extraire les champs du formulaire PDF',
					},
					{
						name: 'Get Text',
						value: 'getText',
						description: 'Extrait le texte brut page par page — fonctionne sur les PDFs aplatis, CERFA remplis, et tout PDF contenant une couche texte',
						action: 'Extraire le texte brut du PDF',
					},
					{
						name: 'Fill Fields',
						value: 'fillFields',
						description: 'Remplit les champs du formulaire PDF avec des valeurs puis sauvegarde ou retourne en binaire',
						action: 'Remplir les champs du formulaire PDF',
					},
				],
				default: 'getFields',
			},

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
				description: 'Comment spécifier le fichier PDF',
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
				placeholder: '/Documents/Formulaires/formulaire.pdf',
				displayOptions: { show: { filePathMode: ['path'] } },
			},

			// ── Fill Fields — Data input ──────────────────────────────────────
			{
				displayName: 'Mode de saisie',
				name: 'dataMode',
				type: 'options',
				displayOptions: { show: { operation: ['fillFields'] } },
				options: [
					{
						name: 'Paires Clé-Valeur',
						value: 'keyValue',
						description: 'Définir chaque champ individuellement — choisissez le champ dans la liste et entrez la valeur',
					},
					{
						name: 'Objet JSON',
						value: 'json',
						description: 'Passer un objet JSON dont les clés sont les noms de champs et les valeurs sont les valeurs à écrire',
					},
				],
				default: 'keyValue',
			},

			// ── Key-Value pairs ───────────────────────────────────────────────
			{
				displayName: 'Valeurs des champs',
				name: 'fieldValues',
				type: 'fixedCollection',
				placeholder: 'Ajouter un champ',
				default: {},
				typeOptions: { multipleValues: true },
				displayOptions: { show: { operation: ['fillFields'], dataMode: ['keyValue'] } },
				description: 'Valeurs à écrire dans chaque champ. Cases à cocher : Oui/Vrai/Yes/True/1 = cochée, Non/Faux/No/False/0 = non cochée.',
				options: [{
					displayName: 'Champ',
					name: 'field',
					values: [
						{
							displayName: 'Nom du champ',
							name: 'name',
							type: 'options',
							typeOptions: {
								loadOptionsMethod: 'getPdfFieldNames',
								loadOptionsDependsOn: ['filePathFromList', 'filePath', 'folderPath'],
							},
							default: '',
							description: 'Sélectionner un champ du PDF',
						},
						{
							displayName: 'Valeur',
							name: 'value',
							type: 'string',
							default: '',
							description: 'Valeur à écrire. Cases à cocher : Oui/Non, Yes/No, True/False, 1/0. Supporte les expressions n8n : {{ $json.valeur }}.',
						},
					],
				}],
			},

			// ── JSON object input ─────────────────────────────────────────────
			{
				displayName: 'Données (JSON)',
				name: 'jsonData',
				type: 'json',
				default: '{}',
				displayOptions: { show: { operation: ['fillFields'], dataMode: ['json'] } },
				description: 'Objet JSON avec les noms de champs comme clés. Cases à cocher : Oui/Non, Yes/No, True/False, 1/0. Exemple : { "Nom": "Dupont", "Etudiant": "Oui", "Couleur": "Rouge" }. Supporte les expressions : ={{ $json }}',
			},

			// ── Flatten ───────────────────────────────────────────────────────
			{
				displayName: 'Aplatir le formulaire',
				name: 'flattenForm',
				type: 'boolean',
				default: false,
				displayOptions: { show: { operation: ['fillFields'] } },
				description: "Si activé, les champs de formulaire sont aplatis dans le document (les champs deviennent du texte imprimé non modifiable)",
			},

			// ── Output mode ───────────────────────────────────────────────────
			{
				displayName: 'Mode de sortie',
				name: 'outputMode',
				type: 'options',
				displayOptions: { show: { operation: ['fillFields'] } },
				options: [
					{
						name: 'Sauvegarder sur Nextcloud',
						value: 'saveToNextcloud',
						description: 'Uploader le PDF rempli à un chemin sur Nextcloud',
					},
					{
						name: 'Retourner en binaire',
						value: 'returnBinary',
						description: 'Retourner le PDF rempli comme item binaire (pièce jointe email, téléchargement, etc.)',
					},
				],
				default: 'saveToNextcloud',
			},

			// ── Save to Nextcloud ─────────────────────────────────────────────
			{
				displayName: 'Destination de sortie',
				name: 'outputPathMode',
				type: 'options',
				displayOptions: { show: { operation: ['fillFields'], outputMode: ['saveToNextcloud'] } },
				options: [
					{ name: 'Choisir un dossier + nom de fichier', value: 'folderBrowser' },
					{ name: 'Par chemin complet (expression)', value: 'path' },
				],
				default: 'folderBrowser',
				description: 'Comment spécifier où sauvegarder le PDF rempli',
			},
			{
				displayName: 'Dossier de sortie',
				name: 'outputFolder',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getOutputFolders' },
				displayOptions: { show: { operation: ['fillFields'], outputMode: ['saveToNextcloud'], outputPathMode: ['folderBrowser'] } },
				default: '/',
				description: 'Dossier sur Nextcloud où le PDF sera sauvegardé',
			},
			{
				displayName: 'Nom du fichier de sortie',
				name: 'outputFileNameBrowser',
				type: 'string',
				default: '',
				placeholder: 'formulaire_{{ $json["Nom de la manifestation"] }}.pdf',
				description: 'Nom du fichier uniquement (sans chemin). Supporte les expressions n8n. Doit se terminer par .pdf.',
				displayOptions: { show: { operation: ['fillFields'], outputMode: ['saveToNextcloud'], outputPathMode: ['folderBrowser'] } },
			},
			{
				displayName: 'Chemin de sortie complet',
				name: 'outputPath',
				type: 'string',
				default: '',
				placeholder: '/Documents/Remplis/formulaire_rempli.pdf',
				description: 'Chemin complet sur Nextcloud. Le dossier parent doit exister. Supporte les expressions.',
				displayOptions: { show: { operation: ['fillFields'], outputMode: ['saveToNextcloud'], outputPathMode: ['path'] } },
				required: true,
			},

			// ── Return as Binary ──────────────────────────────────────────────
			{
				displayName: 'Propriété binaire',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				description: "Nom de la propriété binaire sur l'item de sortie",
				displayOptions: { show: { operation: ['fillFields'], outputMode: ['returnBinary'] } },
			},
			{
				displayName: 'Nom du fichier de sortie',
				name: 'outputFileName',
				type: 'string',
				default: 'formulaire.pdf',
				description: 'Nom du fichier pour la sortie binaire',
				displayOptions: { show: { operation: ['fillFields'], outputMode: ['returnBinary'] } },
			},
		],
	};

	methods = {
		listSearch: {
			async searchPdfFiles(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
				const { searchPdfFiles: search } = await import('../shared/GenericFunctions');
				return search(this, filter);
			},
		},

		loadOptions: {
			async getFolders(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return getFolders(this);
			},
			async getOutputFolders(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return getFolders(this);
			},
			async getPdfFiles(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return getPdfFiles(this);
			},
			async getPdfFieldNames(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const mode = this.getNodeParameter('filePathMode', 'list') as string;
				const filePath = mode === 'list'
					? (this.getNodeParameter('filePathFromList', '') as string)
					: (this.getNodeParameter('filePath', '') as string);
				if (!filePath) return [];
				try {
					const creds = await getCredentials(this);
					const buffer = await downloadFile(this, creds, filePath);
					const fields = await extractPdfFields(buffer);
					if (fields.length === 0) {
						return [{ name: '⚠ Aucun champ de formulaire trouvé dans ce PDF', value: '' }];
					}
					return fields
						.filter(f => f.type !== 'signature' && f.type !== 'button' && f.type !== 'error' && f.type !== 'unknown')
						.map(f => {
							const optPreview = f.options && f.options.length > 0
								? ' · ' + f.options.slice(0, 3).join(', ') + (f.options.length > 3 ? '…' : '')
								: '';
							return {
								name: `${f.name}  [${f.type}${optPreview}]`,
								value: f.name,
							};
						});
				} catch { return []; }
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const operation = this.getNodeParameter('operation', 0) as string;
		const creds = await getCredentials(this);

		for (let i = 0; i < items.length; i++) {
			try {
				const filePathMode = this.getNodeParameter('filePathMode', i, 'list') as string;
				const filePath = filePathMode === 'list'
					? (this.getNodeParameter('filePathFromList', i, '') as string)
					: (this.getNodeParameter('filePath', i, '') as string);
				if (!filePath) throw new NodeOperationError(this.getNode(), 'Aucun fichier PDF spécifié', { itemIndex: i });

				const buffer = await downloadFile(this, creds, filePath);

				// ── GET FIELDS ────────────────────────────────────────────────
				if (operation === 'getFields') {
					const fields = await extractPdfFields(buffer);
					const values: Record<string, unknown> = {};
					for (const f of fields) values[f.name] = f.value;

					returnData.push({
						json: {
							pdfPath: filePath,
							count: fields.length,
							values,
							fields,
						},
					});
					continue;
				}

				// ── GET TEXT ───────────────────────────────────────────────────
				if (operation === 'getText') {
					const parser = new PDFParse({ data: buffer });
					try {
						const result = await parser.getText();
						returnData.push({
							json: {
								pdfPath: filePath,
								text: result.text,
								pageCount: result.total,
								pages: result.pages.map(p => ({ page: p.num, text: p.text })) as IDataObject[],
							},
						});
					} finally {
						await parser.destroy();
					}
					continue;
				}

				// ── FILL FIELDS ───────────────────────────────────────────────
				if (operation === 'fillFields') {
					const dataMode = this.getNodeParameter('dataMode', i, 'keyValue') as string;
					let data: Record<string, unknown> = {};

					if (dataMode === 'keyValue') {
						const raw = this.getNodeParameter('fieldValues', i, {}) as IDataObject;
						const entries = (raw.field as Array<{ name: string; value: string }>) ?? [];
						for (const entry of entries) {
							if (entry.name) data[entry.name] = entry.value ?? '';
						}
					} else {
						const jsonRaw = this.getNodeParameter('jsonData', i, '{}') as string | IDataObject;
						if (typeof jsonRaw === 'string') {
							try { data = JSON.parse(jsonRaw) as Record<string, unknown>; }
							catch { throw new NodeOperationError(this.getNode(), 'JSON invalide dans le champ "Données (JSON)"', { itemIndex: i }); }
						} else {
							data = jsonRaw as Record<string, unknown>;
						}
					}

					// Load PDF and fill fields
					const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
					const form = pdfDoc.getForm();
					const pdfFields = form.getFields();
					const filledFields: string[] = [];
					const skippedFields: string[] = [];

					for (const field of pdfFields) {
						const name = field.getName();
						if (!(name in data)) continue;
						const value = data[name];

						try {
							if (field instanceof PDFTextField) {
								field.setText(value !== null && value !== undefined ? String(value) : '');
								filledFields.push(name);
							} else if (field instanceof PDFCheckBox) {
								if (toBool(value)) field.check(); else field.uncheck();
								filledFields.push(name);
							} else if (field instanceof PDFRadioGroup) {
								if (value !== null && value !== undefined) {
									field.select(String(value));
									filledFields.push(name);
								}
							} else if (field instanceof PDFDropdown) {
								if (value !== null && value !== undefined) {
									field.select(String(value));
									filledFields.push(name);
								}
							} else if (field instanceof PDFOptionList) {
								if (value !== null && value !== undefined) {
									const vals = Array.isArray(value) ? (value as unknown[]).map(String) : [String(value)];
									field.select(vals);
									filledFields.push(name);
								}
							} else {
								skippedFields.push(name);
							}
						} catch {
							skippedFields.push(name);
						}
					}

					const flattenForm = this.getNodeParameter('flattenForm', i, false) as boolean;
					if (flattenForm) {
						try {
							form.flatten();
						} catch {
							// Fallback: fields filled above already have appearance streams;
							// skip the global re-render that fails on empty/unfilled fields.
							form.flatten({ updateFieldAppearances: false });
						}
					}

					const filledBuffer = Buffer.from(await pdfDoc.save());
					const outputMode = this.getNodeParameter('outputMode', i, 'saveToNextcloud') as string;

					if (outputMode === 'saveToNextcloud') {
						const outputPathMode = this.getNodeParameter('outputPathMode', i, 'folderBrowser') as string;
						let outputPath: string;
						if (outputPathMode === 'folderBrowser') {
							const folder = this.getNodeParameter('outputFolder', i, '/') as string;
							const fileName = this.getNodeParameter('outputFileNameBrowser', i, '') as string;
							if (!fileName) throw new NodeOperationError(this.getNode(), '"Nom du fichier de sortie" est requis', { itemIndex: i });
							outputPath = buildOutputPath(folder, fileName);
						} else {
							outputPath = this.getNodeParameter('outputPath', i, '') as string;
							if (!outputPath) throw new NodeOperationError(this.getNode(), '"Chemin de sortie complet" est requis', { itemIndex: i });
						}
						await uploadFile(this, creds, outputPath, filledBuffer, 'application/pdf');
						returnData.push({
							json: {
								success: true,
								operation: 'fillFields',
								pdfPath: filePath,
								outputPath,
								filledFields,
								skippedFields,
								flattenForm,
							},
						});
					} else {
						const binaryProp = this.getNodeParameter('binaryPropertyName', i, 'data') as string;
						const fileName = this.getNodeParameter('outputFileName', i, 'formulaire.pdf') as string;
						const binaryData = await this.helpers.prepareBinaryData(filledBuffer, fileName, 'application/pdf');
						returnData.push({
							json: {
								success: true,
								operation: 'fillFields',
								pdfPath: filePath,
								fileName,
								filledFields,
								skippedFields,
								flattenForm,
							},
							binary: { [binaryProp]: binaryData },
						});
					}
				}

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
