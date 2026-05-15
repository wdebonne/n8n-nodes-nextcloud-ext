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

import ExcelJS from 'exceljs';

import {
	getCredentials,
	downloadFile,
	uploadFile,
	parseWorkbook,
	getSheetNames,
	getWorkbookTables,
	sheetToRows,
	getHeaders,
	getDataRowCount,
	getTableColumns,
	getTableRows,
	appendRowToTable,
	updateRowInTable,
	deleteRowFromTable,
	getSpreadsheetFiles,
	getSheetsForFile,
	getTablesForFile,
	getFolders,
	appendRowXml,
	updateRowXml,
	deleteRowXml,
	clearSheetXml,
	ExcelTableInfo,
} from '../shared/GenericFunctions';

export class NextCloudSpreadsheet implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'NextCloud Spreadsheet',
		name: 'nextCloudSpreadsheet',
		icon: 'file:nextcloud.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + " · " + $parameter["resource"]}}',
		description: 'Read and write spreadsheet files (.xlsx, .ods, .csv) stored on Nextcloud — includes named Excel table support',
		defaults: { name: 'NextCloud Spreadsheet' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'nextCloudApi', required: true }],
		properties: [

			// Resource
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Sheet', value: 'sheet', description: 'Work with worksheet data — first row is treated as column headers' },
					{ name: 'Table', value: 'table', description: 'Work with a named Excel table (Insert → Table in Excel)' },
					{ name: 'Workbook', value: 'workbook', description: 'Inspect the workbook structure (sheets, tables)' },
				],
				default: 'sheet',
			},

			// Sheet operations
			{
				displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
				displayOptions: { show: { resource: ['sheet'] } },
				options: [
					{ name: 'Append Row', value: 'appendRow', description: 'Add a new row at the end of the sheet', action: 'Append a row to a sheet' },
					{ name: 'Clear', value: 'clear', description: 'Delete all data rows (the header row is kept)', action: 'Clear all data rows from a sheet' },
					{ name: 'Delete Row', value: 'deleteRow', description: 'Delete a specific data row by number', action: 'Delete a row from a sheet' },
					{ name: 'Get Columns', value: 'getColumns', description: 'Return the list of column headers', action: 'Get column headers from a sheet' },
					{ name: 'Get Rows', value: 'getRows', description: 'Return all rows as n8n items', action: 'Get all rows from a sheet' },
					{ name: 'Update Row', value: 'updateRow', description: 'Update an existing row by its row number', action: 'Update a row in a sheet' },
				],
				default: 'getRows',
			},

			// Table operations
			{
				displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
				displayOptions: { show: { resource: ['table'] } },
				options: [
					{ name: 'Append Row', value: 'appendRow', description: 'Add a row at the end of the table and extend the table range', action: 'Append a row to a table' },
					{ name: 'Delete Row', value: 'deleteRow', description: 'Remove a data row and shrink the table range', action: 'Delete a row from a table' },
					{ name: 'Get Columns', value: 'getColumns', description: 'Return the column headers of the table', action: 'Get column headers of a table' },
					{ name: 'Get Rows', value: 'getRows', description: 'Return all data rows of the table as n8n items', action: 'Get all rows from a table' },
					{ name: 'List', value: 'list', description: 'List all named tables in the workbook', action: 'List named tables in workbook' },
					{ name: 'Update Row', value: 'updateRow', description: 'Update an existing row by its row number within the table', action: 'Update a row in a table' },
				],
				default: 'getRows',
			},

			// Workbook operations
			{
				displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
				displayOptions: { show: { resource: ['workbook'] } },
				options: [
					{ name: 'Get Sheets', value: 'getSheets', description: 'Return all worksheet names', action: 'Get all sheet names' },
					{ name: 'Get Tables', value: 'getTables', description: 'Return all named tables across all sheets', action: 'Get all named tables' },
				],
				default: 'getSheets',
			},

			// File selector
			{
				displayName: 'From', name: 'filePathMode', type: 'options',
				options: [{ name: 'From List', value: 'list' }, { name: 'By Path (Expression)', value: 'path' }],
				default: 'list', description: 'How to specify the spreadsheet file',
			},
			{
				displayName: 'Folder', name: 'folderPath', type: 'options',
				typeOptions: { loadOptionsMethod: 'getFolders' },
				displayOptions: { show: { filePathMode: ['list'] } },
				default: '/', description: 'Filter the file list to a specific folder',
			},
			{
				displayName: 'File', name: 'filePathFromList', type: 'options',
				typeOptions: { loadOptionsMethod: 'getSpreadsheetFiles', loadOptionsDependsOn: ['folderPath'] },
				displayOptions: { show: { filePathMode: ['list'] } },
				default: '', description: 'Spreadsheet files available in the selected folder',
			},
			{
				displayName: 'File Path', name: 'filePath', type: 'string',
				default: '', placeholder: '/Documents/data.xlsx',
				displayOptions: { show: { filePathMode: ['path'] } },
			},

			// Header Row (global for all sheet operations)
			{
				displayName: 'Header Row',
				name: 'sheetHeaderRow',
				type: 'number',
				default: 1,
				typeOptions: { minValue: 1 },
				description: 'Row number containing the column headers (default 1). Change if your column names are not on the first row.',
				displayOptions: { show: { resource: ['sheet'] } },
			},

			// Sheet selector
			{
				displayName: 'Sheet', name: 'sheetMode', type: 'options',
				options: [{ name: 'From List', value: 'list' }, { name: 'By Name (Expression)', value: 'name' }, { name: 'First Sheet', value: 'first' }],
				default: 'list', description: 'Which worksheet to use',
				displayOptions: { show: { resource: ['sheet'] } },
			},
			{
				displayName: 'Sheet', name: 'sheetFromList', type: 'options',
				typeOptions: { loadOptionsMethod: 'getSheetsForFile' },
				displayOptions: { show: { resource: ['sheet'], sheetMode: ['list'] } },
				default: '', description: 'Select the worksheet',
			},
			{
				displayName: 'Sheet Name', name: 'sheetName', type: 'string',
				default: '', placeholder: 'Sheet1',
				displayOptions: { show: { resource: ['sheet'], sheetMode: ['name'] } },
			},

			// Table selector
			{
				displayName: 'Table', name: 'tableMode', type: 'options',
				options: [{ name: 'From List', value: 'list' }, { name: 'By Name (Expression)', value: 'name' }],
				default: 'list', description: 'Which named table to use',
				displayOptions: { show: { resource: ['table'], operation: ['getRows', 'appendRow', 'updateRow', 'deleteRow', 'getColumns'] } },
			},
			{
				displayName: 'Table', name: 'tableFromList', type: 'options',
				typeOptions: { loadOptionsMethod: 'getTablesForFile' },
				displayOptions: { show: { resource: ['table'], tableMode: ['list'], operation: ['getRows', 'appendRow', 'updateRow', 'deleteRow', 'getColumns'] } },
				default: '', description: 'Select a named table from the workbook',
			},
			{
				displayName: 'Table Name', name: 'tableName', type: 'string',
				default: '', placeholder: 'Tableau1',
				displayOptions: { show: { resource: ['table'], tableMode: ['name'], operation: ['getRows', 'appendRow', 'updateRow', 'deleteRow', 'getColumns'] } },
			},

			// Sheet Get Rows — options + column filter
			{
				displayName: 'Options', name: 'sheetRowOptions', type: 'collection',
				placeholder: 'Add Option', default: {},
				displayOptions: { show: { resource: ['sheet'], operation: ['getRows'] } },
				options: [
					{ displayName: 'Return Last N Rows', name: 'lastNRows', type: 'number', default: 0, typeOptions: { minValue: 0 }, description: '0 = all rows. 1 = last row only. 2 = last 2 rows, etc.' },
					{ displayName: 'Start From Column (Position)', name: 'startColumnIndex', type: 'number', default: 1, typeOptions: { minValue: 1 }, description: 'Column position to start from (1 = first column).' },
				],
			},
			{
				displayName: 'Column Names or IDs', name: 'returnColumns', type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getSheetColumnNames', loadOptionsDependsOn: ['filePathFromList', 'filePath', 'sheetFromList', 'sheetName', 'sheetHeaderRow'] },
				default: [],
				description: 'Columns to include in the output. Reloads when Header Row changes. Leave empty to return all columns.',
				displayOptions: { show: { resource: ['sheet'], operation: ['getRows'] } },
			},

			// Table Get Rows — options + filters + column selector
			{
				displayName: 'Options', name: 'tableRowOptions', type: 'collection',
				placeholder: 'Add Option', default: {},
				displayOptions: { show: { resource: ['table'], operation: ['getRows'] } },
				options: [
					{
						displayName: 'Include Row Number',
						name: 'includeRowNumber',
						type: 'boolean',
						default: false,
						description: 'Add a "__rowNumber" field to each row (1 = first data row of the table). Use this value in Update Row or Delete Row to target the exact row.',
					},
					{ displayName: 'Return Last N Rows', name: 'lastNRows', type: 'number', default: 0, typeOptions: { minValue: 0 }, description: '0 = all rows. 1 = last row only. 2 = last 2 rows, etc.' },
					{ displayName: 'Start From Column (Position)', name: 'startColumnIndex', type: 'number', default: 1, typeOptions: { minValue: 1 }, description: 'Column position to start from (1 = first column).' },
				],
			},
			{
				displayName: 'Filters',
				name: 'tableValueFilters',
				type: 'fixedCollection',
				placeholder: 'Add Filter',
				default: {},
				typeOptions: { multipleValues: true },
				displayOptions: { show: { resource: ['table'], operation: ['getRows'] } },
				description: 'Filter rows where a column matches a specific value. Multiple filters = AND logic (all must match).',
				options: [{
					displayName: 'Filter',
					name: 'filter',
					values: [
						{
							displayName: 'Column Name or ID',
							name: 'column',
							type: 'options',
							typeOptions: {
								loadOptionsMethod: 'getTableColumnNames',
								loadOptionsDependsOn: ['filePathFromList', 'filePath', 'tableFromList', 'tableName'],
							},
							default: '',
							description: 'Column to filter on (e.g. N°)',
						},
						{
							displayName: 'Value',
							name: 'value',
							type: 'string',
							default: '',
							description: 'Value that must match exactly (case-insensitive)',
						},
					],
				}],
			},
			{
				displayName: 'Column Names or IDs', name: 'tableReturnColumns', type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getTableColumnNames', loadOptionsDependsOn: ['filePathFromList', 'filePath', 'tableFromList', 'tableName'] },
				default: [],
				description: 'Columns to include in the output. Leave empty to return all columns.',
				displayOptions: { show: { resource: ['table'], operation: ['getRows'] } },
			},

			// Column Values — Sheet
			{
				displayName: 'Column Values', name: 'columnValues', type: 'fixedCollection',
				placeholder: 'Add Column', default: {}, typeOptions: { multipleValues: true },
				displayOptions: { show: { resource: ['sheet'], operation: ['appendRow', 'updateRow'] } },
				options: [{
					displayName: 'Column', name: 'column', values: [
						{ displayName: 'Column Name or ID', name: 'name', type: 'options', typeOptions: { loadOptionsMethod: 'getSheetColumnNames', loadOptionsDependsOn: ['filePathFromList', 'filePath', 'sheetFromList', 'sheetName', 'sheetHeaderRow'] }, default: '', description: 'Column to write' },
						{ displayName: 'Value', name: 'value', type: 'string', default: '' },
					],
				}],
			},

			// Column Values — Table
			{
				displayName: 'Column Values', name: 'tableColumnValues', type: 'fixedCollection',
				placeholder: 'Add Column', default: {}, typeOptions: { multipleValues: true },
				displayOptions: { show: { resource: ['table'], operation: ['appendRow', 'updateRow'] } },
				options: [{
					displayName: 'Column', name: 'column', values: [
						{ displayName: 'Column Name or ID', name: 'name', type: 'options', typeOptions: { loadOptionsMethod: 'getTableColumnNames', loadOptionsDependsOn: ['filePathFromList', 'filePath', 'tableFromList', 'tableName'] }, default: '', description: 'Column to write' },
						{ displayName: 'Value', name: 'value', type: 'string', default: '' },
					],
				}],
			},

			// Row number — Sheet
			{
				displayName: 'Row Number', name: 'rowNumber', type: 'number', default: 1,
				typeOptions: { minValue: 1 },
				description: 'Row number to act on — 1 = first data row (below the header)',
				displayOptions: { show: { resource: ['sheet'], operation: ['updateRow', 'deleteRow'] } },
			},

			// Row number — Table
			{
				displayName: 'Row Number', name: 'tableRowNumber', type: 'number', default: 1,
				typeOptions: { minValue: 1 },
				description: 'Row number inside the table — 1 = first data row',
				displayOptions: { show: { resource: ['table'], operation: ['updateRow', 'deleteRow'] } },
			},
		],
	};

	methods = {
		listSearch: {
			async searchSpreadsheetFiles(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
				const { searchSpreadsheetFiles } = await import('../shared/GenericFunctions');
				return searchSpreadsheetFiles(this, filter);
			},
			async searchSheetsForFile(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
				const { searchSheetsForFile } = await import('../shared/GenericFunctions');
				return searchSheetsForFile(this, filter);
			},
			async searchTablesForFile(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
				const { searchTablesForFile } = await import('../shared/GenericFunctions');
				return searchTablesForFile(this, filter);
			},
		},

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
			async getSheetColumnNames(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const filePath = resolveFilePath(this);
				if (!filePath) return [];
				const headerRow = Math.max(1, this.getNodeParameter('sheetHeaderRow', 1) as number);
				const sheetMode = this.getNodeParameter('sheetMode', 'list') as string;
				const sheetName = sheetMode === 'list' ? (this.getNodeParameter('sheetFromList', '') as string) : sheetMode === 'name' ? (this.getNodeParameter('sheetName', '') as string) : '';
				try {
					const creds = await getCredentials(this);
					const buffer = await downloadFile(this, creds, filePath);
					const wb = await parseWorkbook(buffer);
					const resolved = sheetName || wb.worksheets[0]?.name;
					if (!resolved) return [];
					const sheet = wb.getWorksheet(resolved);
					if (!sheet) return [];
					return getHeaders(sheet, headerRow).map(h => ({ name: h, value: h }));
				} catch { return []; }
			},
			async getTableColumnNames(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const filePath = resolveFilePath(this);
				if (!filePath) return [];
				const tableMode = this.getNodeParameter('tableMode', 'list') as string;
				const tableName = tableMode === 'list' ? (this.getNodeParameter('tableFromList', '') as string) : (this.getNodeParameter('tableName', '') as string);
				if (!tableName) return [];
				try {
					const cols = await getTableColumns(await downloadFileForOptions(this, filePath), tableName);
					return cols.map(c => ({ name: c, value: c }));
				} catch { return []; }
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;
		const creds = await getCredentials(this);

		for (let i = 0; i < items.length; i++) {
			try {
				const filePathMode = this.getNodeParameter('filePathMode', i, 'list') as string;
				const filePath = filePathMode === 'list'
					? (this.getNodeParameter('filePathFromList', i, '') as string)
					: (this.getNodeParameter('filePath', i, '') as string);
				if (!filePath) throw new NodeOperationError(this.getNode(), 'No file path specified', { itemIndex: i });

				const buffer = await downloadFile(this, creds, filePath);

				// ── WORKBOOK ──────────────────────────────────────────────────
				if (resource === 'workbook') {
					const wb = await parseWorkbook(buffer);
					if (operation === 'getSheets') {
						for (const name of getSheetNames(wb)) returnData.push({ json: { sheetName: name } });
					} else if (operation === 'getTables') {
						const tables: ExcelTableInfo[] = await getWorkbookTables(buffer);
						if (tables.length === 0) returnData.push({ json: { message: 'No named tables found' } });
						for (const t of tables) returnData.push({ json: { name: t.name, displayName: t.displayName, sheetName: t.sheetName, ref: t.ref, columns: t.columns, dataRowCount: t.dataRowCount } });
					}
					continue;
				}

				// ── TABLE ─────────────────────────────────────────────────────
				if (resource === 'table') {
					if (operation === 'list') {
						const tables: ExcelTableInfo[] = await getWorkbookTables(buffer);
						if (tables.length === 0) returnData.push({ json: { message: 'No named tables found' } });
						for (const t of tables) returnData.push({ json: { name: t.name, displayName: t.displayName, sheetName: t.sheetName, ref: t.ref, columns: t.columns, dataRowCount: t.dataRowCount } });
						continue;
					}

					const tableMode = this.getNodeParameter('tableMode', i, 'list') as string;
					const tableName = tableMode === 'list' ? (this.getNodeParameter('tableFromList', i, '') as string) : (this.getNodeParameter('tableName', i, '') as string);
					if (!tableName) throw new NodeOperationError(this.getNode(), 'No table name specified', { itemIndex: i });

					if (operation === 'getColumns') {
						const columns = await getTableColumns(buffer, tableName);
						returnData.push({ json: { tableName, columns, count: columns.length, filePath } });
					} else if (operation === 'getRows') {
						const returnCols = this.getNodeParameter('tableReturnColumns', i, []) as string[];
						const tblOpts = this.getNodeParameter('tableRowOptions', i, {}) as IDataObject;
						const includeRowNum = (tblOpts.includeRowNumber as boolean) ?? false;
						const tLastN = Math.max(0, (tblOpts.lastNRows as number) ?? 0);
						const tStartCol = Math.max(1, (tblOpts.startColumnIndex as number) ?? 1);

						// Value filters (column = value)
						const filtersCol = this.getNodeParameter('tableValueFilters', i, {}) as IDataObject;
						const valueFilters = ((filtersCol.filter as IDataObject[]) ?? []) as Array<{ column: string; value: string }>;

						// Step 1: get ALL rows without any filter
						let rows = await getTableRows(buffer, tableName);

						// Step 2: add __rowNumber BEFORE filtering so it reflects
						//         the actual row position in the table (not filtered position)
						if (includeRowNum) {
							rows = rows.map((row, idx) => ({ __rowNumber: idx + 1, ...row }));
						}

						// Step 3: apply value filters AFTER assigning row numbers
						if (valueFilters.length > 0) {
							rows = rows.filter(row =>
								valueFilters.every(f =>
									String(row[f.column] ?? '').toLowerCase() === f.value.toLowerCase(),
								),
							);
						}

						// Column start offset
						if (tStartCol > 1 && rows.length > 0) {
							const dataCols = Object.keys(rows[0]).filter(k => k !== '__rowNumber');
							const allowed = dataCols.slice(tStartCol - 1);
							const keep = includeRowNum ? ['__rowNumber', ...allowed] : allowed;
							rows = rows.map(row => { const out: IDataObject = {}; for (const k of keep) out[k] = row[k]; return out; });
						}

						// Named column selector
						if (returnCols.length > 0) {
							rows = rows.map(row => {
								const out: IDataObject = {};
								if (includeRowNum) out['__rowNumber'] = row['__rowNumber'];
								for (const c of returnCols) out[c] = row[c];
								return out;
							});
						}

						// Last N rows
						if (tLastN > 0) rows = rows.slice(-tLastN);
						for (const row of rows) returnData.push({ json: row });
					} else if (operation === 'appendRow') {
						const colValues = this.getNodeParameter('tableColumnValues', i, {}) as IDataObject;
						const columns = (colValues.column as Array<{ name: string; value: string }>) ?? [];
						const rowData: IDataObject = {};
						for (const col of columns) rowData[col.name] = col.value;
						const out = await appendRowToTable(buffer, tableName, rowData);
						await uploadFile(this, creds, filePath, out);
						returnData.push({ json: { success: true, operation: 'appendRow', tableName, rowData } });
					} else if (operation === 'updateRow') {
						const rowNumber = this.getNodeParameter('tableRowNumber', i, 1) as number;
						const colValues = this.getNodeParameter('tableColumnValues', i, {}) as IDataObject;
						const columns = (colValues.column as Array<{ name: string; value: string }>) ?? [];
						const rowData: IDataObject = {};
						for (const col of columns) rowData[col.name] = col.value;
						const out = await updateRowInTable(buffer, tableName, rowNumber, rowData);
						await uploadFile(this, creds, filePath, out);
						returnData.push({ json: { success: true, operation: 'updateRow', tableName, rowNumber, rowData } });
					} else if (operation === 'deleteRow') {
						const rowNumber = this.getNodeParameter('tableRowNumber', i, 1) as number;
						const out = await deleteRowFromTable(buffer, tableName, rowNumber);
						await uploadFile(this, creds, filePath, out);
						returnData.push({ json: { success: true, operation: 'deleteRow', tableName, deletedRow: rowNumber } });
					}
					continue;
				}

				// ── SHEET ─────────────────────────────────────────────────────
				if (resource === 'sheet') {
					const globalHeaderRow = Math.max(1, this.getNodeParameter('sheetHeaderRow', i, 1) as number);
					const globalHeaderIdx = globalHeaderRow - 1; // 0-based

					const sheetMode = this.getNodeParameter('sheetMode', i, 'list') as string;
					let sheetName = sheetMode === 'list'
						? (this.getNodeParameter('sheetFromList', i, '') as string)
						: sheetMode === 'name' ? (this.getNodeParameter('sheetName', i, '') as string) : '';

					const wb = await parseWorkbook(buffer);
					if (!sheetName) sheetName = wb.worksheets[0]?.name ?? '';
					const sheet = wb.getWorksheet(sheetName);
					if (!sheet) throw new NodeOperationError(this.getNode(), `Sheet "${sheetName}" not found. Available: ${getSheetNames(wb).join(', ')}`, { itemIndex: i });

					const sheetColCount = sheet.columnCount || (sheet.lastRow?.actualCellCount ?? 1);
					const colStart = 1; // 1-based ExcelJS
					const colEnd = sheetColCount;

					if (operation === 'getRows') {
						const returnCols = this.getNodeParameter('returnColumns', i, []) as string[];
						const sOpts = this.getNodeParameter('sheetRowOptions', i, {}) as IDataObject;
						const sLastN = Math.max(0, (sOpts.lastNRows as number) ?? 0);
						const sStartCol = Math.max(1, (sOpts.startColumnIndex as number) ?? 1);

						let rows = sheetToRows(sheet, globalHeaderRow, sStartCol);
						if (returnCols.length > 0) rows = rows.map(row => { const out: IDataObject = {}; for (const c of returnCols) out[c] = row[c]; return out; });
						if (sLastN > 0) rows = rows.slice(-sLastN);
						for (const row of rows) returnData.push({ json: row });

					} else if (operation === 'getColumns') {
						const headers = getHeaders(sheet, globalHeaderRow);
						returnData.push({ json: { columns: headers, count: headers.length, sheetName, filePath, headerRow: globalHeaderRow } });

					} else if (operation === 'appendRow') {
						const colValues = this.getNodeParameter('columnValues', i, {}) as IDataObject;
						const columns = (colValues.column as Array<{ name: string; value: string }>) ?? [];
						const rowData: IDataObject = {};
						for (const col of columns) rowData[col.name] = col.value;
						const out = await appendRowXml(buffer, sheetName, globalHeaderIdx, colStart - 1, colEnd - 1, rowData, wb);
						await uploadFile(this, creds, filePath, out);
						returnData.push({ json: { success: true, operation: 'appendRow', sheetName, rowData, headerRow: globalHeaderRow } });

					} else if (operation === 'updateRow') {
						const rowNumber = this.getNodeParameter('rowNumber', i, 1) as number;
						const colValues = this.getNodeParameter('columnValues', i, {}) as IDataObject;
						const columns = (colValues.column as Array<{ name: string; value: string }>) ?? [];
						const rowData: IDataObject = {};
						for (const col of columns) rowData[col.name] = col.value;
						const out = await updateRowXml(buffer, sheetName, globalHeaderIdx, colStart - 1, colEnd - 1, rowNumber, rowData, wb);
						await uploadFile(this, creds, filePath, out);
						returnData.push({ json: { success: true, operation: 'updateRow', sheetName, rowNumber, rowData, headerRow: globalHeaderRow } });

					} else if (operation === 'deleteRow') {
						const rowNumber = this.getNodeParameter('rowNumber', i, 1) as number;
						const out = await deleteRowXml(buffer, sheetName, globalHeaderIdx, rowNumber);
						await uploadFile(this, creds, filePath, out);
						returnData.push({ json: { success: true, operation: 'deleteRow', sheetName, deletedRow: rowNumber } });

					} else if (operation === 'clear') {
						const headers = getHeaders(sheet, globalHeaderRow);
						const out = await clearSheetXml(buffer, sheetName, globalHeaderIdx);
						await uploadFile(this, creds, filePath, out);
						returnData.push({ json: { success: true, operation: 'clear', sheetName, columnsPreserved: headers } });
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

function resolveFilePath(context: ILoadOptionsFunctions): string {
	const mode = context.getNodeParameter('filePathMode', 'list') as string;
	return mode === 'list'
		? (context.getNodeParameter('filePathFromList', '') as string)
		: (context.getNodeParameter('filePath', '') as string);
}

async function downloadFileForOptions(context: ILoadOptionsFunctions, filePath: string): Promise<Buffer> {
	const { getCredentials, downloadFile } = await import('../shared/GenericFunctions');
	const creds = await getCredentials(context);
	return downloadFile(context, creds, filePath);
}
