import {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
	IDataObject,
} from 'n8n-workflow';

import {
	getCredentials,
	downloadFile,
	parseWorkbook,
	getHeaders,
	sheetToRows,
	getTableRows,
	getTableColumns,
	getSpreadsheetFiles,
	getSheetsForFile,
	getTablesForFile,
	getFolders,
} from '../shared/GenericFunctions';

export class NextCloudSearch implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'NextCloud Search',
		name: 'nextCloudSearch',
		icon: 'file:nextcloud.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["sourceType"] === "table" ? "Table" : "Sheet"}} · lookup',
		description: 'Search for a value in a Nextcloud spreadsheet column and return the value from another column on the same row',
		defaults: { name: 'NextCloud Search' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'nextCloudApi', required: true }],
		properties: [

			// ── Source type ──────────────────────────────────────────────────
			{
				displayName: 'Source Type',
				name: 'sourceType',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Sheet', value: 'sheet', description: 'Search in a worksheet — first row is treated as column headers' },
					{ name: 'Table', value: 'table', description: 'Search in a named Excel table (Insert → Table in Excel)' },
				],
				default: 'sheet',
			},

			// ── File selector ────────────────────────────────────────────────
			{
				displayName: 'From',
				name: 'filePathMode',
				type: 'options',
				options: [
					{ name: 'From List', value: 'list' },
					{ name: 'By Path (Expression)', value: 'path' },
				],
				default: 'list',
				description: 'How to specify the spreadsheet file',
			},
			{
				displayName: 'Folder',
				name: 'folderPath',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getFolders' },
				displayOptions: { show: { filePathMode: ['list'] } },
				default: '/',
				description: 'Filter the file list to a specific folder',
			},
			{
				displayName: 'File',
				name: 'filePathFromList',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getSpreadsheetFiles', loadOptionsDependsOn: ['folderPath'] },
				displayOptions: { show: { filePathMode: ['list'] } },
				default: '',
				description: 'Spreadsheet file to search in',
			},
			{
				displayName: 'File Path',
				name: 'filePath',
				type: 'string',
				default: '',
				placeholder: '/Documents/catalogue.xlsx',
				displayOptions: { show: { filePathMode: ['path'] } },
			},

			// ── Sheet selector ───────────────────────────────────────────────
			{
				displayName: 'Header Row',
				name: 'headerRow',
				type: 'number',
				default: 1,
				typeOptions: { minValue: 1 },
				description: 'Row number containing column headers (default 1)',
				displayOptions: { show: { sourceType: ['sheet'] } },
			},
			{
				displayName: 'Sheet',
				name: 'sheetMode',
				type: 'options',
				options: [
					{ name: 'From List', value: 'list' },
					{ name: 'By Name (Expression)', value: 'name' },
					{ name: 'First Sheet', value: 'first' },
				],
				default: 'list',
				description: 'Which worksheet to use',
				displayOptions: { show: { sourceType: ['sheet'] } },
			},
			{
				displayName: 'Sheet',
				name: 'sheetFromList',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getSheetsForFile' },
				displayOptions: { show: { sourceType: ['sheet'], sheetMode: ['list'] } },
				default: '',
				description: 'Select the worksheet',
			},
			{
				displayName: 'Sheet Name',
				name: 'sheetName',
				type: 'string',
				default: '',
				placeholder: 'Sheet1',
				displayOptions: { show: { sourceType: ['sheet'], sheetMode: ['name'] } },
			},

			// ── Table selector ───────────────────────────────────────────────
			{
				displayName: 'Table',
				name: 'tableMode',
				type: 'options',
				options: [
					{ name: 'From List', value: 'list' },
					{ name: 'By Name (Expression)', value: 'name' },
				],
				default: 'list',
				description: 'Which named table to use',
				displayOptions: { show: { sourceType: ['table'] } },
			},
			{
				displayName: 'Table',
				name: 'tableFromList',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getTablesForFile' },
				displayOptions: { show: { sourceType: ['table'], tableMode: ['list'] } },
				default: '',
				description: 'Select a named table from the workbook',
			},
			{
				displayName: 'Table Name',
				name: 'tableName',
				type: 'string',
				default: '',
				placeholder: 'Tableau1',
				displayOptions: { show: { sourceType: ['table'], tableMode: ['name'] } },
			},

			// ── Lookups ──────────────────────────────────────────────────────
			{
				displayName: 'Lookups',
				name: 'lookups',
				type: 'fixedCollection',
				placeholder: 'Add Lookup',
				default: {},
				typeOptions: { multipleValues: true },
				description: 'Each lookup searches a column for a value and writes the result of another column to a named output field',
				options: [{
					displayName: 'Lookup',
					name: 'lookup',
					values: [
						{
							displayName: 'Search Column',
							name: 'searchColumn',
							type: 'options',
							typeOptions: {
								loadOptionsMethod: 'getColumnNames',
								loadOptionsDependsOn: [
									'filePathFromList', 'filePath',
									'sourceType',
									'sheetFromList', 'sheetName', 'headerRow',
									'tableFromList', 'tableName',
								],
							},
							default: '',
							description: 'Column to search in (e.g. "Nom du matériel")',
						},
						{
							displayName: 'Search Value',
							name: 'searchValue',
							type: 'string',
							default: '',
							description: 'Value to look for — supports expressions (e.g. {{ $json.materiel_nom_1 }})',
						},
						{
							displayName: 'Return Column',
							name: 'returnColumn',
							type: 'options',
							typeOptions: {
								loadOptionsMethod: 'getColumnNames',
								loadOptionsDependsOn: [
									'filePathFromList', 'filePath',
									'sourceType',
									'sheetFromList', 'sheetName', 'headerRow',
									'tableFromList', 'tableName',
								],
							},
							default: '',
							description: 'Column whose value to return when a match is found (e.g. "Prix")',
						},
						{
							displayName: 'Output Field Name',
							name: 'outputField',
							type: 'string',
							default: '',
							placeholder: 'materiel_prix_1',
							description: 'Name of the JSON field written to the output item',
						},
					],
				}],
			},

			// ── Options ──────────────────────────────────────────────────────
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Case Sensitive',
						name: 'caseSensitive',
						type: 'boolean',
						default: false,
						description: 'Whether the search should match case exactly',
					},
					{
						displayName: 'If Not Found',
						name: 'ifNotFound',
						type: 'options',
						options: [
							{ name: 'Set to Null', value: 'null', description: 'Write null to the output field and continue' },
							{ name: 'Throw Error', value: 'error', description: 'Stop and report an error for this item' },
						],
						default: 'null',
						description: 'What to do when no matching row is found',
					},
					{
						displayName: 'Pass Through Original Data',
						name: 'passThrough',
						type: 'boolean',
						default: true,
						description: 'Include all original input fields in the output item alongside the lookup results',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getFolders(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return getFolders(this);
			},
			async getSpreadsheetFiles(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return getSpreadsheetFiles(this);
			},
			async getSheetsForFile(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const filePath = resolveFilePath(this);
				if (!filePath) return [];
				return getSheetsForFile(this, filePath);
			},
			async getTablesForFile(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const filePath = resolveFilePath(this);
				if (!filePath) return [];
				return getTablesForFile(this, filePath);
			},
			async getColumnNames(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const filePath = resolveFilePath(this);
				if (!filePath) return [];
				const sourceType = this.getNodeParameter('sourceType', 'sheet') as string;
				try {
					const creds = await getCredentials(this);
					const buffer = await downloadFile(this, creds, filePath);
					if (sourceType === 'table') {
						const tableMode = this.getNodeParameter('tableMode', 'list') as string;
						const tableName = tableMode === 'list'
							? (this.getNodeParameter('tableFromList', '') as string)
							: (this.getNodeParameter('tableName', '') as string);
						if (!tableName) return [];
						const cols = await getTableColumns(buffer, tableName);
						return cols.map(c => ({ name: c, value: c }));
					} else {
						const headerRow = Math.max(1, this.getNodeParameter('headerRow', 1) as number);
						const sheetMode = this.getNodeParameter('sheetMode', 'list') as string;
						const sheetName = sheetMode === 'list'
							? (this.getNodeParameter('sheetFromList', '') as string)
							: sheetMode === 'name'
								? (this.getNodeParameter('sheetName', '') as string)
								: '';
						const wb = await parseWorkbook(buffer);
						const resolved = sheetName || wb.worksheets[0]?.name;
						if (!resolved) return [];
						const sheet = wb.getWorksheet(resolved);
						if (!sheet) return [];
						return getHeaders(sheet, headerRow).map(h => ({ name: h, value: h }));
					}
				} catch { return []; }
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const creds = await getCredentials(this);

		for (let i = 0; i < items.length; i++) {
			try {
				const sourceType = this.getNodeParameter('sourceType', i) as string;
				const filePathMode = this.getNodeParameter('filePathMode', i, 'list') as string;
				const filePath = filePathMode === 'list'
					? (this.getNodeParameter('filePathFromList', i, '') as string)
					: (this.getNodeParameter('filePath', i, '') as string);
				if (!filePath) throw new NodeOperationError(this.getNode(), 'No file path specified', { itemIndex: i });

				const opts = this.getNodeParameter('options', i, {}) as IDataObject;
				const caseSensitive = (opts.caseSensitive as boolean) ?? false;
				const ifNotFound = (opts.ifNotFound as string) ?? 'null';
				const passThrough = (opts.passThrough as boolean) ?? true;

				const lookupsRaw = this.getNodeParameter('lookups', i, {}) as IDataObject;
				const lookups = (lookupsRaw.lookup as Array<{
					searchColumn: string;
					searchValue: string;
					returnColumn: string;
					outputField: string;
				}>) ?? [];

				if (lookups.length === 0) {
					returnData.push({ json: passThrough ? { ...items[i].json } : {}, pairedItem: i });
					continue;
				}

				// Download once per item (same file for all lookups)
				const buffer = await downloadFile(this, creds, filePath);

				// Load rows (sheet or table)
				let rows: IDataObject[] = [];
				if (sourceType === 'table') {
					const tableMode = this.getNodeParameter('tableMode', i, 'list') as string;
					const tableName = tableMode === 'list'
						? (this.getNodeParameter('tableFromList', i, '') as string)
						: (this.getNodeParameter('tableName', i, '') as string);
					if (!tableName) throw new NodeOperationError(this.getNode(), 'No table specified', { itemIndex: i });
					rows = await getTableRows(buffer, tableName);
				} else {
					const headerRow = Math.max(1, this.getNodeParameter('headerRow', i, 1) as number);
					const sheetMode = this.getNodeParameter('sheetMode', i, 'list') as string;
					let sheetName = sheetMode === 'list'
						? (this.getNodeParameter('sheetFromList', i, '') as string)
						: sheetMode === 'name'
							? (this.getNodeParameter('sheetName', i, '') as string)
							: '';
					const wb = await parseWorkbook(buffer);
					if (!sheetName) sheetName = wb.worksheets[0]?.name ?? '';
					const sheet = wb.getWorksheet(sheetName);
					if (!sheet) throw new NodeOperationError(this.getNode(), `Sheet "${sheetName}" not found`, { itemIndex: i });
					rows = sheetToRows(sheet, headerRow);
				}

				// Build output: start from original item if passThrough
				const outJson: IDataObject = passThrough ? { ...items[i].json } : {};

				for (const lookup of lookups) {
					const { searchColumn, searchValue, returnColumn, outputField } = lookup;
					if (!searchColumn || !returnColumn || !outputField) continue;

					const match = rows.find(row => {
						const cellVal = String(row[searchColumn] ?? '');
						return caseSensitive
							? cellVal === searchValue
							: cellVal.toLowerCase() === searchValue.toLowerCase();
					});

					if (!match) {
						if (ifNotFound === 'error') {
							throw new NodeOperationError(
								this.getNode(),
								`No row found where "${searchColumn}" = "${searchValue}"`,
								{ itemIndex: i },
							);
						}
						outJson[outputField] = null;
					} else {
						outJson[outputField] = match[returnColumn] ?? null;
					}
				}

				returnData.push({ json: outJson, pairedItem: i });
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

function resolveFilePath(context: ILoadOptionsFunctions): string {
	const mode = context.getNodeParameter('filePathMode', 'list') as string;
	return mode === 'list'
		? (context.getNodeParameter('filePathFromList', '') as string)
		: (context.getNodeParameter('filePath', '') as string);
}
