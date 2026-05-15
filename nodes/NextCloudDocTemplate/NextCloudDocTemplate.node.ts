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
	getCredentials,
	downloadFile,
	uploadFile,
	getFolders,
	getDocFiles,
	searchDocFiles,
	extractCarboneVariables,
	renderCarboneTemplate,
	buildOutputPath,
} from '../shared/GenericFunctions';

export class NextCloudDocTemplate implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'NextCloud Doc Template',
		name: 'nextCloudDocTemplate',
		icon: 'file:nextcloud.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Fill DOCX/ODT templates stored on Nextcloud using Carbone syntax — {d.variable}, {d.array[i].field} for dynamic pages',
		defaults: { name: 'NextCloud Doc Template' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'nextCloudApi', required: true }],
		properties: [

			// ── Operation ─────────────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Fill Template',
						value: 'fillTemplate',
						description: 'Replace {d.variable} placeholders in a DOCX/ODT template with your data',
						action: 'Fill a DOCX template with data',
					},
					{
						name: 'Get Variables',
						value: 'getVariables',
						description: 'Scan the template and return all {d.variable} placeholder names found',
						action: 'Get all variable names from a template',
					},
				],
				default: 'fillTemplate',
			},

			// ── Template file selection ───────────────────────────────────────
			{
				displayName: 'Template From',
				name: 'filePathMode',
				type: 'options',
				options: [
					{ name: 'From List', value: 'list' },
					{ name: 'By Path (Expression)', value: 'path' },
				],
				default: 'list',
				description: 'How to specify the template file',
			},
			{
				displayName: 'Template Folder',
				name: 'folderPath',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getFolders' },
				displayOptions: { show: { filePathMode: ['list'] } },
				default: '/',
				description: 'Folder containing the template',
			},
			{
				displayName: 'Template File',
				name: 'filePathFromList',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getDocFiles',
					loadOptionsDependsOn: ['folderPath'],
				},
				displayOptions: { show: { filePathMode: ['list'] } },
				default: '',
				description: 'DOCX or ODT template files in the selected folder',
			},
			{
				displayName: 'Template File Path',
				name: 'filePath',
				type: 'string',
				default: '',
				placeholder: '/Documents/Templates/contrat.docx',
				displayOptions: { show: { filePathMode: ['path'] } },
			},

			// ── Data input mode ───────────────────────────────────────────────
			{
				displayName: 'Data Mode',
				name: 'dataMode',
				type: 'options',
				displayOptions: { show: { operation: ['fillTemplate'] } },
				options: [
					{
						name: 'Key-Value Pairs',
						value: 'keyValue',
						description: 'Set each {d.variable} individually — ideal for simple documents',
					},
					{
						name: 'JSON Object',
						value: 'json',
						description: 'Pass a full JSON object — required for arrays and dynamic pages ({d.items[i].field})',
					},
				],
				default: 'keyValue',
			},

			// ── Key-Value pairs ───────────────────────────────────────────────
			{
				displayName: 'Template Variables',
				name: 'templateValues',
				type: 'fixedCollection',
				placeholder: 'Add Variable',
				default: {},
				typeOptions: { multipleValues: true },
				displayOptions: { show: { operation: ['fillTemplate'], dataMode: ['keyValue'] } },
				description: 'Values to inject. Each key matches a {d.key} placeholder in the template.',
				options: [{
					displayName: 'Variable',
					name: 'variable',
					values: [
						{
							displayName: 'Variable Name or ID',
							name: 'name',
							type: 'options',
							typeOptions: {
								loadOptionsMethod: 'getDocVariables',
								loadOptionsDependsOn: ['filePathFromList', 'filePath', 'folderPath'],
							},
							default: '',
							description: 'Select a placeholder found in the template',
						},
						{
							displayName: 'Value',
							name: 'value',
							type: 'string',
							default: '',
							description: 'Value to insert. Supports n8n expressions like {{ $json.clientName }}.',
						},
					],
				}],
			},

			// ── JSON Object input ─────────────────────────────────────────────
			{
				displayName: 'Data (JSON)',
				name: 'jsonData',
				type: 'json',
				default: '{}',
				displayOptions: { show: { operation: ['fillTemplate'], dataMode: ['json'] } },
				description: 'JSON object passed as the "d" context in the template. Use {d.field} for strings and {d.array[i].field} to repeat sections/pages for each array item.',
			},

			// ── Output format ─────────────────────────────────────────────────
			{
				displayName: 'Output Format',
				name: 'outputFormat',
				type: 'options',
				displayOptions: { show: { operation: ['fillTemplate'] } },
				options: [
					{
						name: 'DOCX',
						value: 'docx',
						description: 'Word document — no external dependency',
					},
					{
						name: 'PDF',
						value: 'pdf',
						description: 'PDF — requires LibreOffice installed on the n8n server',
					},
				],
				default: 'docx',
			},

			// ── Output mode ───────────────────────────────────────────────────
			{
				displayName: 'Output Mode',
				name: 'outputMode',
				type: 'options',
				displayOptions: { show: { operation: ['fillTemplate'] } },
				options: [
					{
						name: 'Save to Nextcloud',
						value: 'saveToNextcloud',
						description: 'Upload the filled document to a folder on Nextcloud',
					},
					{
						name: 'Return as Binary',
						value: 'returnBinary',
						description: 'Return the filled document as a binary item (email attachments, downloads, etc.)',
					},
				],
				default: 'saveToNextcloud',
			},

			// ── Save to Nextcloud: folder browser ─────────────────────────────
			{
				displayName: 'Output Destination',
				name: 'outputPathMode',
				type: 'options',
				displayOptions: { show: { operation: ['fillTemplate'], outputMode: ['saveToNextcloud'] } },
				options: [
					{ name: 'Select Folder + File Name', value: 'folderBrowser' },
					{ name: 'By Path (Expression)', value: 'path' },
				],
				default: 'folderBrowser',
				description: 'How to specify where to save the output file',
			},
			{
				displayName: 'Output Folder',
				name: 'outputFolder',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getOutputFolders' },
				displayOptions: { show: { operation: ['fillTemplate'], outputMode: ['saveToNextcloud'], outputPathMode: ['folderBrowser'] } },
				default: '/',
				description: 'Folder on Nextcloud where the file will be saved',
			},
			{
				displayName: 'Output File Name',
				name: 'outputFileNameBrowser',
				type: 'string',
				default: '',
				placeholder: 'contrat_{{ $json.client }}.docx',
				description: 'File name only (no path). Supports expressions. Extension should match the Output Format (.docx or .pdf).',
				displayOptions: { show: { operation: ['fillTemplate'], outputMode: ['saveToNextcloud'], outputPathMode: ['folderBrowser'] } },
			},
			{
				displayName: 'Output File Path',
				name: 'outputPath',
				type: 'string',
				default: '',
				placeholder: '/Documents/Filled/contrat_2025.docx',
				description: 'Full path on Nextcloud. The parent folder must already exist. Supports expressions.',
				displayOptions: { show: { operation: ['fillTemplate'], outputMode: ['saveToNextcloud'], outputPathMode: ['path'] } },
				required: true,
			},

			// ── Return as Binary ──────────────────────────────────────────────
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				description: 'Name of the binary property on the output item',
				displayOptions: { show: { operation: ['fillTemplate'], outputMode: ['returnBinary'] } },
			},
			{
				displayName: 'Output File Name',
				name: 'outputFileName',
				type: 'string',
				default: 'document.docx',
				description: 'File name for the binary output. Extension should match the Output Format (.docx or .pdf).',
				displayOptions: { show: { operation: ['fillTemplate'], outputMode: ['returnBinary'] } },
			},
		],
	};

	methods = {
		listSearch: {
			async searchDocFiles(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
				const { searchDocFiles: search } = await import('../shared/GenericFunctions');
				return search(this, filter);
			},
		},

		loadOptions: {
			async getFolders(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return getFolders(this);
			},
			// Separate method for the output folder so it can be used independently
			async getOutputFolders(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return getFolders(this);
			},
			async getDocFiles(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return getDocFiles(this);
			},
			async getDocVariables(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const mode = this.getNodeParameter('filePathMode', 'list') as string;
				const filePath = mode === 'list'
					? (this.getNodeParameter('filePathFromList', '') as string)
					: (this.getNodeParameter('filePath', '') as string);
				if (!filePath) return [];
				try {
					const creds = await getCredentials(this);
					const buffer = await downloadFile(this, creds, filePath);
					const variables = await extractCarboneVariables(buffer);
					if (variables.length === 0) {
						return [{ name: '⚠ Aucune variable {d.xxx} trouvée — ajoutez des placeholders dans votre template', value: '' }];
					}
					return variables.map(v => ({ name: `{d.${v}}`, value: v }));
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
				// Resolve template file path
				const filePathMode = this.getNodeParameter('filePathMode', i, 'list') as string;
				const filePath = filePathMode === 'list'
					? (this.getNodeParameter('filePathFromList', i, '') as string)
					: (this.getNodeParameter('filePath', i, '') as string);
				if (!filePath) throw new NodeOperationError(this.getNode(), 'No template file specified', { itemIndex: i });

				const buffer = await downloadFile(this, creds, filePath);

				// ── GET VARIABLES ─────────────────────────────────────────────
				if (operation === 'getVariables') {
					const variables = await extractCarboneVariables(buffer);
					returnData.push({
						json: {
							variables: variables.map(v => `{d.${v}}`),
							rawKeys: variables,
							count: variables.length,
							templatePath: filePath,
						},
					});
					continue;
				}

				// ── FILL TEMPLATE ─────────────────────────────────────────────
				if (operation === 'fillTemplate') {
					// Build data object
					const dataMode = this.getNodeParameter('dataMode', i, 'keyValue') as string;
					let data: Record<string, unknown> = {};

					if (dataMode === 'keyValue') {
						const raw = this.getNodeParameter('templateValues', i, {}) as IDataObject;
						const entries = (raw.variable as Array<{ name: string; value: string }>) ?? [];
						for (const entry of entries) {
							if (entry.name) data[entry.name] = entry.value ?? '';
						}
					} else {
						const jsonRaw = this.getNodeParameter('jsonData', i, '{}') as string | IDataObject;
						if (typeof jsonRaw === 'string') {
							try { data = JSON.parse(jsonRaw) as Record<string, unknown>; }
							catch { throw new NodeOperationError(this.getNode(), 'Invalid JSON in "Data (JSON)" field', { itemIndex: i }); }
						} else {
							data = jsonRaw as Record<string, unknown>;
						}
					}

					// Output format
					const outputFormat = this.getNodeParameter('outputFormat', i, 'docx') as 'docx' | 'pdf';
					const mimeType = outputFormat === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

					// Render with Carbone
					let filledBuffer: Buffer;
					try {
						filledBuffer = await renderCarboneTemplate(buffer, data, outputFormat);
					} catch (carboneErr) {
						const msg = carboneErr instanceof Error ? carboneErr.message : String(carboneErr);
						throw new NodeOperationError(this.getNode(), `Carbone render error: ${msg}`, { itemIndex: i });
					}

					const outputMode = this.getNodeParameter('outputMode', i, 'saveToNextcloud') as string;

					// ── Save to Nextcloud ─────────────────────────────────────
					if (outputMode === 'saveToNextcloud') {
						const outputPathMode = this.getNodeParameter('outputPathMode', i, 'folderBrowser') as string;
						let outputPath: string;

						if (outputPathMode === 'folderBrowser') {
							const folder = this.getNodeParameter('outputFolder', i, '/') as string;
							const fileName = this.getNodeParameter('outputFileNameBrowser', i, '') as string;
							if (!fileName) throw new NodeOperationError(this.getNode(), '"Output File Name" is required', { itemIndex: i });
							outputPath = buildOutputPath(folder, fileName);
						} else {
							outputPath = this.getNodeParameter('outputPath', i, '') as string;
							if (!outputPath) throw new NodeOperationError(this.getNode(), '"Output File Path" is required', { itemIndex: i });
						}

						await uploadFile(this, creds, outputPath, filledBuffer, mimeType);
						returnData.push({
							json: {
								success: true,
								operation: 'fillTemplate',
								templatePath: filePath,
								outputPath,
								outputFormat,
								variablesUsed: Object.keys(data),
								count: Object.keys(data).length,
							},
						});

					// ── Return as Binary ──────────────────────────────────────
					} else {
						const binaryProp = this.getNodeParameter('binaryPropertyName', i, 'data') as string;
						const fileName = this.getNodeParameter('outputFileName', i, `document.${outputFormat}`) as string;
						const binaryData = await this.helpers.prepareBinaryData(filledBuffer, fileName, mimeType);
						returnData.push({
							json: {
								success: true,
								operation: 'fillTemplate',
								templatePath: filePath,
								fileName,
								outputFormat,
								variablesUsed: Object.keys(data),
								count: Object.keys(data).length,
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
