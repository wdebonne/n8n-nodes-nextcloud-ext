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
	uploadFile,
	parseWorkbook,
	serializeWorkbook,
	getSheetNames,
	getWorkbookTables,
	sheetToRows,
	getHeaders,
	getDataRowCount,
	appendRowToSheet,
	updateRowInSheet,
	deleteRowFromSheet,
	getTableColumns,
	getTableRows,
	appendRowToTable,
	updateRowInTable,
	deleteRowFromTable,
	getSpreadsheetFiles,
	getSheetsForFile,
	getTablesForFile,
	getFolders,
	ExcelTableInfo,
} from '../shared/GenericFunctions';

import * as xlsx from 'xlsx';

export class NextCloudSpreadsheet implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Nextcloud Spreadsheet',
		name: 'nextCloudSpreadsheet',
		icon: 'file:nextcloud.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + " · " + $parameter["resource"]}}',
		description: 'Read and write spreadsheet files (.xlsx, .ods, .csv) stored on Nextcloud — includes named Excel table support',
		defaults: {
			name: 'Nextcloud Spreadsheet',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'nextCloudApi',
				required: true,
			},
		],
		properties: [

			// ==================================================================
			// Resource
			// ==================================================================
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Sheet',
						value: 'sheet',
						description: 'Work with worksheet data — first row is treated as column headers',
					},
					{
						name: 'Table',
						value: 'table',
						description: 'Work with a named Excel table (Insert → Table in Excel)',
					},
					{
						name: 'Workbook',
						value: 'workbook',
						description: 'Inspect the workbook structure (sheets, tables)',
					},
				],
				default: 'sheet',
			},

			// ==================================================================
			// SHEET operations
			// ==================================================================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['sheet'] } },
				options: [
					{
						name: 'Append Row',
						value: 'appendRow',
						description: 'Add a new row at the end of the sheet',
						action: 'Append a row to a sheet',
					},
					{
						name: 'Clear',
						value: 'clear',
						description: 'Delete all data rows (the header row is kept)',
						action: 'Clear all data rows from a sheet',
					},
					{
						name: 'Delete Row',
						value: 'deleteRow',
						description: 'Delete a specific data row by number',
						action: 'Delete a row from a sheet',
					},
					{
						name: 'Get Columns',
						value: 'getColumns',
						description: 'Return the list of column headers (first row)',
						action: 'Get column headers from a sheet',
					},
					{
						name: 'Get Rows',
						value: 'getRows',
						description: 'Return all rows as n8n items',
						action: 'Get all rows from a sheet',
					},
					{
						name: 'Update Row',
						value: 'updateRow',
						description: 'Update an existing row by its row number',
						action: 'Update a row in a sheet',
					},
				],
				default: 'getRows',
			},

			// ==================================================================
			// TABLE operations
			// ==================================================================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['table'] } },
				options: [
					{
						name: 'Append Row',
						value: 'appendRow',
						description: 'Add a row at the end of the table and extend the table range',
						action: 'Append a row to a table',
					},
					{
						name: 'Delete Row',
						value: 'deleteRow',
						description: 'Remove a data row and shrink the table range',
						action: 'Delete a row from a table',
					},
					{
						name: 'Get Columns',
						value: 'getColumns',
						description: 'Return the column headers of the table',
						action: 'Get column headers of a table',
					},
					{
						name: 'Get Rows',
						value: 'getRows',
						description: 'Return all data rows of the table as n8n items',
						action: 'Get all rows from a table',
					},
					{
						name: 'List',
						value: 'list',
						description: 'List all named tables in the workbook',
						action: 'List named tables in workbook',
					},
					{
						name: 'Update Row',
						value: 'updateRow',
						description: 'Update an existing row by its row number within the table',
						action: 'Update a row in a table',
					},
				],
				default: 'getRows',
			},

			// ==================================================================
			// WORKBOOK operations
			// ==================================================================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['workbook'] } },
				options: [
					{
						name: 'Get Sheets',
						value: 'getSheets',
						description: 'Return all worksheet names',
						action: 'Get all sheet names',
					},
					{
						name: 'Get Tables',
						value: 'getTables',
						description: 'Return all named tables across all sheets',
						action: 'Get all named tables',
					},
				],
				default: 'getSheets',
			},

			// ==================================================================
			// File selector (shared by all resources)
			// ==================================================================
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
				typeOptions: {
					loadOptionsMethod: 'getFolders',
				},
				displayOptions: { show: { filePathMode: ['list'] } },
				default: '/',
				description: 'Filter the file list to a specific folder (root + 2 levels)',
			},
			{
				displayName: 'File',
				name: 'filePathFromList',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getSpreadsheetFiles',
					loadOptionsDependsOn: ['folderPath'],
				},
				displayOptions: { show: { filePathMode: ['list'] } },
				default: '',
				description: 'Spreadsheet files available in the selected folder',
			},
			{
				displayName: 'File Path',
				name: 'filePath',
				type: 'string',
				default: '',
				placeholder: '/Documents/data.xlsx',
				description: 'Path of the spreadsheet file on Nextcloud',
				displayOptions: { show: { filePathMode: ['path'] } },
			},

			// ==================================================================
			// Sheet selector (Sheet resource only)
			// ==================================================================
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
				displayOptions: { show: { resource: ['sheet'] } },
			},
			{
				displayName: 'Sheet',
				name: 'sheetFromList',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getSheetsForFile',
				},
				displayOptions: {
					show: {
						resource: ['sheet'],
						sheetMode: ['list'],
					},
				},
				default: '',
				description: 'Select the worksheet',
			},
			{
				displayName: 'Sheet Name',
				name: 'sheetName',
				type: 'string',
				default: '',
				placeholder: 'Sheet1',
				description: 'Exact name of the worksheet',
				displayOptions: {
					show: {
						resource: ['sheet'],
						sheetMode: ['name'],
					},
				},
			},

			// ==================================================================
			// Table selector (Table resource only — not for List operation)
			// ==================================================================
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
				displayOptions: {
					show: {
						resource: ['table'],
						operation: ['getRows', 'appendRow', 'updateRow', 'deleteRow', 'getColumns'],
					},
				},
			},
			{
				displayName: 'Table',
				name: 'tableFromList',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getTablesForFile',
				},
				displayOptions: {
					show: {
						resource: ['table'],
						tableMode: ['list'],
						operation: ['getRows', 'appendRow', 'updateRow', 'deleteRow', 'getColumns'],
					},
				},
				default: '',
				description: 'Select a named table from the workbook',
			},
			{
				displayName: 'Table Name',
				name: 'tableName',
				type: 'string',
				default: '',
				placeholder: 'Tableau1',
				description: 'Exact name of the Excel table (case-sensitive)',
				displayOptions: {
					show: {
						resource: ['table'],
						tableMode: ['name'],
						operation: ['getRows', 'appendRow', 'updateRow', 'deleteRow', 'getColumns'],
					},
				},
			},

			// ==================================================================
			// GET ROWS (sheet) — options first (drives column names), then column selector
			// ==================================================================
			{
				displayName: 'Options',
				name: 'sheetRowOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: {
					show: {
						resource: ['sheet'],
						operation: ['getRows'],
					},
				},
				options: [
					{
						displayName: 'Header Row',
						name: 'startRow',
						type: 'number',
						default: 1,
						typeOptions: { minValue: 1 },
						description: 'Row number containing the column headers (default 1 = first row). Change this if your column names are not on the first row — Column Names or IDs will update automatically.',
					},
					{
						displayName: 'Return Last N Rows',
						name: 'lastNRows',
						type: 'number',
						default: 0,
						typeOptions: { minValue: 0 },
						description: '0 = all rows. 1 = last row only. 2 = last 2 rows, etc.',
					},
					{
						displayName: 'Start From Column (Position)',
						name: 'startColumnIndex',
						type: 'number',
						default: 1,
						typeOptions: { minValue: 1 },
						description: 'Column position to start from (1 = first column). Columns before this position are ignored.',
					},
				],
			},
			{
				displayName: 'Column Names or IDs',
				name: 'returnColumns',
				type: 'multiOptions',
				typeOptions: {
					loadOptionsMethod: 'getSheetColumnNames',
					loadOptionsDependsOn: ['filePathFromList', 'filePath', 'sheetFromList', 'sheetName', 'sheetRowOptions'],
				},
				default: [],
				description: 'Columns to include in the output. Reloads automatically when Header Row changes. Leave empty to return all columns.',
				displayOptions: {
					show: {
						resource: ['sheet'],
						operation: ['getRows'],
					},
				},
			},

			// ==================================================================
			// GET ROWS (table) — column selector + options
			// ==================================================================
			{
				displayName: 'Column Names or IDs',
				name: 'tableReturnColumns',
				type: 'multiOptions',
				typeOptions: {
					loadOptionsMethod: 'getTableColumnNames',
					loadOptionsDependsOn: ['filePathFromList', 'filePath', 'tableFromList', 'tableName'],
				},
				default: [],
				description: 'Columns to include in the output. Leave empty to return all columns.',
				displayOptions: {
					show: {
						resource: ['table'],
						operation: ['getRows'],
					},
				},
			},
			{
				displayName: 'Options',
				name: 'tableRowOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: {
					show: {
						resource: ['table'],
						operation: ['getRows'],
					},
				},
				options: [
					{
						displayName: 'Start From Row',
						name: 'startRow',
						type: 'number',
						default: 1,
						typeOptions: { minValue: 1 },
						description: 'First data row to return within the table (1 = first data row). Use to skip rows at the top.',
					},
					{
						displayName: 'Return Last N Rows',
						name: 'lastNRows',
						type: 'number',
						default: 0,
						typeOptions: { minValue: 0 },
						description: '0 = all rows. 1 = last row only. 2 = last 2 rows, etc. Applied after "Start From Row".',
					},
					{
						displayName: 'Start From Column (Position)',
						name: 'startColumnIndex',
						type: 'number',
						default: 1,
						typeOptions: { minValue: 1 },
						description: 'Column position to start from within the table (1 = first column).',
					},
				],
			},

			// ==================================================================
			// APPEND / UPDATE ROW — column values (sheet)
			// ==================================================================
			{
				displayName: 'Column Values',
				name: 'columnValues',
				type: 'fixedCollection',
				placeholder: 'Add Column',
				default: {},
				typeOptions: { multipleValues: true },
				displayOptions: {
					show: {
						resource: ['sheet'],
						operation: ['appendRow', 'updateRow'],
					},
				},
				options: [
					{
						displayName: 'Column',
						name: 'column',
						values: [
							{
								displayName: 'Column Name or ID',
								name: 'name',
								type: 'options',
								typeOptions: {
									loadOptionsMethod: 'getSheetColumnNames',
									loadOptionsDependsOn: ['filePathFromList', 'filePath', 'sheetFromList', 'sheetName'],
								},
								default: '',
								description: 'Column to write — loaded from the first row of the sheet',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
							},
						],
					},
				],
			},

			// ==================================================================
			// APPEND / UPDATE ROW — column values (table)
			// ==================================================================
			{
				displayName: 'Column Values',
				name: 'tableColumnValues',
				type: 'fixedCollection',
				placeholder: 'Add Column',
				default: {},
				typeOptions: { multipleValues: true },
				displayOptions: {
					show: {
						resource: ['table'],
						operation: ['appendRow', 'updateRow'],
					},
				},
				options: [
					{
						displayName: 'Column',
						name: 'column',
						values: [
							{
								displayName: 'Column Name or ID',
								name: 'name',
								type: 'options',
								typeOptions: {
									loadOptionsMethod: 'getTableColumnNames',
									loadOptionsDependsOn: ['filePathFromList', 'filePath', 'tableFromList', 'tableName'],
								},
								default: '',
								description: 'Column to write — loaded from the table definition',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
							},
						],
					},
				],
			},

			// ==================================================================
			// Row number (sheet)
			// ==================================================================
			{
				displayName: 'Row Number',
				name: 'rowNumber',
				type: 'number',
				default: 1,
				typeOptions: { minValue: 1 },
				description: 'Row number to act on — 1 = first data row (the row immediately below the header)',
				displayOptions: {
					show: {
						resource: ['sheet'],
						operation: ['updateRow', 'deleteRow'],
					},
				},
			},

			// ==================================================================
			// Row number (table)
			// ==================================================================
			{
				displayName: 'Row Number',
				name: 'tableRowNumber',
				type: 'number',
				default: 1,
				typeOptions: { minValue: 1 },
				description: 'Row number inside the table — 1 = first data row (does not count the header)',
				displayOptions: {
					show: {
						resource: ['table'],
						operation: ['updateRow', 'deleteRow'],
					},
				},
			},
		],
	};

	// ============================================================
	// Load-options methods (dynamic dropdowns)
	// ============================================================
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

			async getTableColumnNames(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const filePath = resolveFilePath(this);
				if (!filePath) return [];
				const tableMode = this.getNodeParameter('tableMode', 'list') as string;
				const tableName =
					tableMode === 'list'
						? (this.getNodeParameter('tableFromList', '') as string)
						: (this.getNodeParameter('tableName', '') as string);
				if (!tableName) return [];
				try {
					const creds = await getCredentials(this);
					const buffer = await downloadFile(this, creds, filePath);
					const columns = await getTableColumns(buffer, tableName);
					return columns.map((col) => ({ name: col, value: col }));
				} catch {
					return [];
				}
			},

			async getSheetColumnNames(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const filePath = resolveFilePath(this);
				if (!filePath) return [];
				const sheetMode = this.getNodeParameter('sheetMode', 'list') as string;
				const sheetName =
					sheetMode === 'list'
						? (this.getNodeParameter('sheetFromList', '') as string)
						: sheetMode === 'name'
						? (this.getNodeParameter('sheetName', '') as string)
						: '';

				// Read header row from Options (default 1 = first row)
				const rowOpts = this.getNodeParameter('sheetRowOptions', {}) as IDataObject;
				const headerRow = Math.max(1, (rowOpts.startRow as number) ?? 1);

				try {
					const creds = await getCredentials(this);
					const buffer = await downloadFile(this, creds, filePath);
					const workbook = parseWorkbook(buffer);
					const resolved = sheetName || workbook.SheetNames[0];
					if (!workbook.SheetNames.includes(resolved)) return [];
					const sheet = workbook.Sheets[resolved];
					const range = xlsx.utils.decode_range(sheet['!ref'] ?? 'A1');
					// Read column names from the specified header row (1-based → 0-based)
					const headerRowIdx = Math.min(headerRow - 1, range.e.r);
					const options: INodePropertyOptions[] = [];
					for (let c = range.s.c; c <= range.e.c; c++) {
						const cell = sheet[xlsx.utils.encode_cell({ r: headerRowIdx, c })];
						const val = cell ? String(cell.v).trim() : '';
						if (val) options.push({ name: val, value: val });
					}
					return options;
				} catch {
					return [];
				}
			},
		},
	};

	// ============================================================
	// Execute
	// ============================================================
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;
		const creds = await getCredentials(this);

		for (let i = 0; i < items.length; i++) {
			try {
				// ----------------------------------------------------------
				// Resolve file path
				// ----------------------------------------------------------
				const filePathMode = this.getNodeParameter('filePathMode', i, 'list') as string;
				const filePath =
					filePathMode === 'list'
						? (this.getNodeParameter('filePathFromList', i, '') as string)
						: (this.getNodeParameter('filePath', i, '') as string);

				if (!filePath) {
					throw new NodeOperationError(this.getNode(), 'No file path specified', { itemIndex: i });
				}
				const fileExt = filePath.split('.').pop() ?? 'xlsx';

				// ----------------------------------------------------------
				// WORKBOOK resource
				// ----------------------------------------------------------
				if (resource === 'workbook') {
					const buffer = await downloadFile(this, creds, filePath);

					if (operation === 'getSheets') {
						const wb = parseWorkbook(buffer);
						for (const name of getSheetNames(wb)) {
							returnData.push({ json: { sheetName: name } });
						}
					} else if (operation === 'getTables') {
						const tables: ExcelTableInfo[] = await getWorkbookTables(buffer);
						if (tables.length === 0) {
							returnData.push({ json: { message: 'No named tables found in this workbook' } });
						}
						for (const t of tables) {
							returnData.push({
								json: {
									name: t.name,
									displayName: t.displayName,
									sheetName: t.sheetName,
									ref: t.ref,
									columns: t.columns,
									dataRowCount: t.dataRowCount,
								},
							});
						}
					}
					continue;
				}

				// ----------------------------------------------------------
				// TABLE resource
				// ----------------------------------------------------------
				if (resource === 'table') {
					const buffer = await downloadFile(this, creds, filePath);

					// List all tables — no table name needed
					if (operation === 'list') {
						const tables: ExcelTableInfo[] = await getWorkbookTables(buffer);
						if (tables.length === 0) {
							returnData.push({ json: { message: 'No named tables found in this workbook' } });
						}
						for (const t of tables) {
							returnData.push({
								json: {
									name: t.name,
									displayName: t.displayName,
									sheetName: t.sheetName,
									ref: t.ref,
									columns: t.columns,
									dataRowCount: t.dataRowCount,
								},
							});
						}
						continue;
					}

					// Resolve table name
					const tableMode = this.getNodeParameter('tableMode', i, 'list') as string;
					const tableName =
						tableMode === 'list'
							? (this.getNodeParameter('tableFromList', i, '') as string)
							: (this.getNodeParameter('tableName', i, '') as string);

					if (!tableName) {
						throw new NodeOperationError(this.getNode(), 'No table name specified', {
							itemIndex: i,
						});
					}

					if (operation === 'getColumns') {
						const columns = await getTableColumns(buffer, tableName);
						returnData.push({
							json: { tableName, columns, count: columns.length, filePath },
						});
					} else if (operation === 'getRows') {
						const returnCols = this.getNodeParameter('tableReturnColumns', i, []) as string[];
						const tblOpts = this.getNodeParameter('tableRowOptions', i, {}) as IDataObject;
						const tStartRow = Math.max(1, (tblOpts.startRow as number) ?? 1);
						const tLastN = Math.max(0, (tblOpts.lastNRows as number) ?? 0);
						const tStartCol = Math.max(1, (tblOpts.startColumnIndex as number) ?? 1);

						let rows = await getTableRows(buffer, tableName);

						// 1. Column start — drop columns before position N
						if (tStartCol > 1 && rows.length > 0) {
							const allCols = Object.keys(rows[0]);
							const allowedCols = allCols.slice(tStartCol - 1);
							rows = rows.map((row) => {
								const out: IDataObject = {};
								for (const col of allowedCols) out[col] = row[col];
								return out;
							});
						}

						// 2. Named column filter
						if (returnCols.length > 0) {
							rows = rows.map((row) => {
								const out: IDataObject = {};
								for (const col of returnCols) out[col] = row[col];
								return out;
							});
						}

						// 3. Start row — skip first N-1 data rows
						if (tStartRow > 1) rows = rows.slice(tStartRow - 1);

						// 4. Last N rows
						if (tLastN > 0) rows = rows.slice(-tLastN);

						for (const row of rows) returnData.push({ json: row });
					} else if (operation === 'appendRow') {
						const colValues = this.getNodeParameter('tableColumnValues', i, {}) as IDataObject;
						const columns = (colValues.column as Array<{ name: string; value: string }>) ?? [];
						const rowData: IDataObject = {};
						for (const col of columns) rowData[col.name] = col.value;

						const outBuffer = await appendRowToTable(buffer, tableName, rowData, fileExt);
						await uploadFile(this, creds, filePath, outBuffer);

						returnData.push({
							json: { success: true, operation: 'appendRow', tableName, rowData },
						});
					} else if (operation === 'updateRow') {
						const rowNumber = this.getNodeParameter('tableRowNumber', i, 1) as number;
						const colValues = this.getNodeParameter('tableColumnValues', i, {}) as IDataObject;
						const columns = (colValues.column as Array<{ name: string; value: string }>) ?? [];
						const rowData: IDataObject = {};
						for (const col of columns) rowData[col.name] = col.value;

						const outBuffer = await updateRowInTable(buffer, tableName, rowNumber, rowData, fileExt);
						await uploadFile(this, creds, filePath, outBuffer);

						returnData.push({
							json: { success: true, operation: 'updateRow', tableName, rowNumber, rowData },
						});
					} else if (operation === 'deleteRow') {
						const rowNumber = this.getNodeParameter('tableRowNumber', i, 1) as number;

						const outBuffer = await deleteRowFromTable(buffer, tableName, rowNumber, fileExt);
						await uploadFile(this, creds, filePath, outBuffer);

						returnData.push({
							json: {
								success: true,
								operation: 'deleteRow',
								tableName,
								deletedRow: rowNumber,
							},
						});
					}
					continue;
				}

				// ----------------------------------------------------------
				// SHEET resource
				// ----------------------------------------------------------
				if (resource === 'sheet') {
					// Resolve sheet name
					const sheetMode = this.getNodeParameter('sheetMode', i, 'list') as string;
					let sheetName =
						sheetMode === 'list'
							? (this.getNodeParameter('sheetFromList', i, '') as string)
							: sheetMode === 'name'
							? (this.getNodeParameter('sheetName', i, '') as string)
							: '';

					const buffer = await downloadFile(this, creds, filePath);
					const workbook = parseWorkbook(buffer);

					if (!sheetName) sheetName = workbook.SheetNames[0];

					if (!workbook.SheetNames.includes(sheetName)) {
						throw new NodeOperationError(
							this.getNode(),
							`Sheet "${sheetName}" not found. Available: ${workbook.SheetNames.join(', ')}`,
							{ itemIndex: i },
						);
					}

					const sheet = workbook.Sheets[sheetName];

					if (operation === 'getRows') {
						const returnCols = this.getNodeParameter('returnColumns', i, []) as string[];
						const sOpts = this.getNodeParameter('sheetRowOptions', i, {}) as IDataObject;
						// headerRow: row containing column names (1-based). Data starts from headerRow+1.
						const headerRow = Math.max(1, (sOpts.startRow as number) ?? 1);
						const sLastN = Math.max(0, (sOpts.lastNRows as number) ?? 0);
						const sStartCol = Math.max(1, (sOpts.startColumnIndex as number) ?? 1);

						const range = xlsx.utils.decode_range(sheet['!ref'] ?? 'A1');
						const headerRowIdx = Math.min(headerRow - 1, range.e.r); // 0-based

						// Read column headers from the specified row
						const allHeaders: string[] = [];
						for (let c = range.s.c; c <= range.e.c; c++) {
							const cell = sheet[xlsx.utils.encode_cell({ r: headerRowIdx, c })];
							allHeaders.push(cell ? String(cell.v).trim() : `Column${c - range.s.c + 1}`);
						}

						// Apply column start offset
						const activeHeaders = allHeaders.slice(sStartCol - 1);
						const activeColStart = range.s.c + sStartCol - 1;

						// Read data from headerRow+1 onwards
						let rows: IDataObject[] = [];
						for (let r = headerRowIdx + 1; r <= range.e.r; r++) {
							const row: IDataObject = {};
							for (let hi = 0; hi < activeHeaders.length; hi++) {
								const c = activeColStart + hi;
								const cell = sheet[xlsx.utils.encode_cell({ r, c })];
								row[activeHeaders[hi]] = cell ? cell.v : '';
							}
							rows.push(row);
						}

						// Named column filter
						if (returnCols.length > 0) {
							rows = rows.map((row) => {
								const out: IDataObject = {};
								for (const col of returnCols) out[col] = row[col];
								return out;
							});
						}

						// Last N rows
						if (sLastN > 0) rows = rows.slice(-sLastN);

						for (const row of rows) returnData.push({ json: row });
					} else if (operation === 'getColumns') {
						const headers = getHeaders(sheet);
						returnData.push({
							json: { columns: headers, count: headers.length, sheetName, filePath },
						});
					} else if (operation === 'appendRow') {
						const colValues = this.getNodeParameter('columnValues', i, {}) as IDataObject;
						const columns = (colValues.column as Array<{ name: string; value: string }>) ?? [];
						const rowData: IDataObject = {};
						for (const col of columns) rowData[col.name] = col.value;

						appendRowToSheet(sheet, rowData);
						const outBuffer = serializeWorkbook(workbook, fileExt);
						await uploadFile(this, creds, filePath, outBuffer);

						returnData.push({
							json: {
								success: true,
								operation: 'appendRow',
								sheetName,
								rowData,
								totalRows: getDataRowCount(sheet),
							},
						});
					} else if (operation === 'updateRow') {
						const rowNumber = this.getNodeParameter('rowNumber', i, 1) as number;
						const colValues = this.getNodeParameter('columnValues', i, {}) as IDataObject;
						const columns = (colValues.column as Array<{ name: string; value: string }>) ?? [];
						const rowData: IDataObject = {};
						for (const col of columns) rowData[col.name] = col.value;

						updateRowInSheet(sheet, rowNumber, rowData);
						const outBuffer = serializeWorkbook(workbook, fileExt);
						await uploadFile(this, creds, filePath, outBuffer);

						returnData.push({
							json: { success: true, operation: 'updateRow', sheetName, rowNumber, rowData },
						});
					} else if (operation === 'deleteRow') {
						const rowNumber = this.getNodeParameter('rowNumber', i, 1) as number;
						deleteRowFromSheet(workbook, sheetName, rowNumber);
						const outBuffer = serializeWorkbook(workbook, fileExt);
						await uploadFile(this, creds, filePath, outBuffer);

						returnData.push({
							json: { success: true, operation: 'deleteRow', sheetName, deletedRow: rowNumber },
						});
					} else if (operation === 'clear') {
						const headers = getHeaders(sheet);
						workbook.Sheets[sheetName] = xlsx.utils.aoa_to_sheet([headers]);
						const outBuffer = serializeWorkbook(workbook, fileExt);
						await uploadFile(this, creds, filePath, outBuffer);

						returnData.push({
							json: { success: true, operation: 'clear', sheetName, columnsPreserved: headers },
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

// Helper used by loadOptions methods (no item index context available there)
function resolveFilePath(context: ILoadOptionsFunctions): string {
	const mode = context.getNodeParameter('filePathMode', 'list') as string;
	if (mode === 'list') {
		return context.getNodeParameter('filePathFromList', '') as string;
	}
	return context.getNodeParameter('filePath', '') as string;
}
