import {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	IHttpRequestOptions,
	IDataObject,
	NodeApiError,
	INodePropertyOptions,
	INodeListSearchResult,
} from 'n8n-workflow';

import { XMLParser } from 'fast-xml-parser';
import ExcelJS from 'exceljs';

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

export interface NextCloudCredentials {
	serverUrl: string;
	user: string;
	password: string;
}

export async function getCredentials(
	context: IExecuteFunctions | ILoadOptionsFunctions,
): Promise<NextCloudCredentials> {
	const creds = await context.getCredentials('nextCloudApi');
	return {
		serverUrl: (creds.serverUrl as string).replace(/\/$/, ''),
		user: creds.user as string,
		password: creds.password as string,
	};
}

function authHeader(user: string, password: string): string {
	return 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
}

// ---------------------------------------------------------------------------
// WebDAV base URL builder
// ---------------------------------------------------------------------------

export function davUrl(serverUrl: string, user: string, filePath: string): string {
	const clean = filePath.replace(/^\/+/, '');
	return `${serverUrl}/remote.php/dav/files/${encodeURIComponent(user)}/${clean}`;
}

// ---------------------------------------------------------------------------
// Low-level WebDAV request helper
// ---------------------------------------------------------------------------

export async function webdavRequest(
	context: IExecuteFunctions | ILoadOptionsFunctions,
	method: string,
	url: string,
	creds: NextCloudCredentials,
	extraHeaders: IDataObject = {},
	body?: string,
	encoding?: 'arraybuffer' | undefined,
): Promise<{ statusCode: number; headers: IDataObject; body: Buffer | string }> {
	const options: IHttpRequestOptions = {
		method: method as IHttpRequestOptions['method'],
		url,
		headers: {
			Authorization: authHeader(creds.user, creds.password),
			...extraHeaders,
		},
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};

	if (body !== undefined) {
		options.body = body;
		options.headers!['Content-Type'] = 'application/xml; charset=utf-8';
	}

	if (encoding === 'arraybuffer') {
		options.encoding = 'arraybuffer';
	}

	try {
		const response = await (context as IExecuteFunctions).helpers.httpRequest(options);
		return {
			statusCode: response.statusCode as number,
			headers: response.headers as IDataObject,
			body: response.body as Buffer | string,
		};
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		throw new NodeApiError(context.getNode(), { message: msg });
	}
}

// ---------------------------------------------------------------------------
// PROPFIND — list a directory
// ---------------------------------------------------------------------------

const PROPFIND_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <d:getcontentlength/>
    <d:getcontenttype/>
    <d:getlastmodified/>
    <oc:fileid/>
    <oc:size/>
  </d:prop>
</d:propfind>`;

export interface DavEntry {
	href: string;
	name: string;
	isDirectory: boolean;
	size: number;
	contentType: string;
	lastModified: string;
	fileId: string;
}

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

export async function listDirectory(
	context: IExecuteFunctions | ILoadOptionsFunctions,
	creds: NextCloudCredentials,
	path: string,
	depth: '0' | '1' | 'infinity' = '1',
): Promise<DavEntry[]> {
	const url = davUrl(creds.serverUrl, creds.user, path);
	const response = await webdavRequest(context, 'PROPFIND', url, creds, { Depth: depth }, PROPFIND_BODY);

	if (response.statusCode >= 400) {
		throw new NodeApiError(context.getNode(), {
			message: `PROPFIND failed: ${response.statusCode}`,
			description: String(response.body).slice(0, 500),
		});
	}

	return parsePropfind(String(response.body), creds.serverUrl, creds.user);
}

function parsePropfind(xml: string, serverUrl: string, user: string): DavEntry[] {
	const parsed = (new XMLParser({ ignoreAttributes: false, parseTagValue: false })).parse(xml);
	const multistatus = parsed['d:multistatus'] || parsed['D:multistatus'] || parsed.multistatus || {};
	const rawResponses = multistatus['d:response'] || multistatus['D:response'] || multistatus.response || [];
	const responses = Array.isArray(rawResponses) ? rawResponses : [rawResponses];
	const baseDavPath = `/remote.php/dav/files/${encodeURIComponent(user)}/`;

	return responses.map((r: IDataObject): DavEntry => {
		const prop = extractProp(r);
		const href = String(r['d:href'] || r['D:href'] || r.href || '');
		const relPath = href.startsWith(baseDavPath) ? href.slice(baseDavPath.length) : href;
		const resourcetype = (prop['d:resourcetype'] || prop['D:resourcetype'] || prop.resourcetype || {}) as Record<string, unknown>;
		const isDirectory = typeof resourcetype === 'object' &&
			('d:collection' in resourcetype || 'D:collection' in resourcetype || 'collection' in resourcetype);

		return {
			href,
			name: decodeURIComponent(relPath.replace(/\/$/, '').split('/').pop() || relPath),
			isDirectory,
			size: Number(prop['d:getcontentlength'] || prop['oc:size'] || prop.size || 0),
			contentType: String(prop['d:getcontenttype'] || prop.getcontenttype || ''),
			lastModified: String(prop['d:getlastmodified'] || prop.getlastmodified || ''),
			fileId: String(prop['oc:fileid'] || prop.fileid || ''),
		};
	});
}

function extractProp(response: IDataObject): IDataObject {
	const propstat = response['d:propstat'] || response['D:propstat'] || response.propstat || {};
	const first = Array.isArray(propstat) ? propstat[0] : propstat;
	return (first['d:prop'] as IDataObject) || (first['D:prop'] as IDataObject) || (first.prop as IDataObject) || {};
}

// ---------------------------------------------------------------------------
// Download / Upload
// ---------------------------------------------------------------------------

export async function downloadFile(
	context: IExecuteFunctions | ILoadOptionsFunctions,
	creds: NextCloudCredentials,
	filePath: string,
): Promise<Buffer> {
	const url = davUrl(creds.serverUrl, creds.user, filePath);
	const response = await webdavRequest(context, 'GET', url, creds, {}, undefined, 'arraybuffer');
	if (response.statusCode >= 400) {
		throw new NodeApiError(context.getNode(), { message: `Download failed (${response.statusCode}): ${filePath}` });
	}
	return Buffer.from(response.body as unknown as ArrayBuffer);
}

export async function uploadFile(
	context: IExecuteFunctions,
	creds: NextCloudCredentials,
	filePath: string,
	data: Buffer,
	contentType = 'application/octet-stream',
): Promise<void> {
	const url = davUrl(creds.serverUrl, creds.user, filePath);
	const options: IHttpRequestOptions = {
		method: 'PUT',
		url,
		headers: { Authorization: authHeader(creds.user, creds.password), 'Content-Type': contentType },
		body: data,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	const response = await context.helpers.httpRequest(options);
	const status = response.statusCode as number;
	if (status >= 400) {
		throw new NodeApiError(context.getNode(), { message: `Upload failed (${status}): ${filePath}` });
	}
}

// ---------------------------------------------------------------------------
// ExcelJS — load / save
// ---------------------------------------------------------------------------

export async function parseWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
	const wb = new ExcelJS.Workbook();
	await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
	return wb;
}

async function saveWorkbook(wb: ExcelJS.Workbook): Promise<Buffer> {
	return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
}

// Resolve cell value (handles formulas, rich text, hyperlinks)
function cellValue(cell: ExcelJS.Cell): unknown {
	const v = cell.value;
	if (v === null || v === undefined) return '';
	if (v instanceof Date) return v;
	if (typeof v === 'object') {
		if ('formula' in v || 'sharedFormula' in v) return (v as ExcelJS.CellFormulaValue).result ?? '';
		if ('error' in v) return '';
		if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map(r => r.text).join('');
		if ('hyperlink' in v) return (v as ExcelJS.CellHyperlinkValue).text ?? '';
	}
	return v;
}

// ---------------------------------------------------------------------------
// Sheet helpers
// ---------------------------------------------------------------------------

export function getSheetNames(wb: ExcelJS.Workbook): string[] {
	return wb.worksheets.map(ws => ws.name);
}

// Read column headers from a specific row (1-based)
export function getHeaders(sheet: ExcelJS.Worksheet, headerRow: number): string[] {
	const row = sheet.getRow(headerRow);
	const headers: string[] = [];
	row.eachCell({ includeEmpty: false }, (cell, colIdx) => {
		while (headers.length < colIdx - 1) headers.push(`Column${headers.length + 1}`);
		headers.push(String(cellValue(cell) || `Column${colIdx}`));
	});
	return headers;
}

// Read all data rows starting from headerRow+1
export function sheetToRows(
	sheet: ExcelJS.Worksheet,
	headerRow: number,
	colStart = 1,
): IDataObject[] {
	const headers = getHeaders(sheet, headerRow);
	const rows: IDataObject[] = [];
	sheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
		if (rowNum <= headerRow) return;
		const obj: IDataObject = {};
		headers.forEach((h, i) => {
			obj[h] = cellValue(row.getCell(colStart + i)) as IDataObject[string];
		});
		rows.push(obj);
	});
	return rows;
}

export function getDataRowCount(sheet: ExcelJS.Worksheet, headerRow: number): number {
	return Math.max(0, (sheet.lastRow?.number ?? headerRow) - headerRow);
}

// ---------------------------------------------------------------------------
// ExcelJS — table helpers
// ---------------------------------------------------------------------------

export interface ExcelTableInfo {
	name: string;
	displayName: string;
	ref: string;
	sheetName: string;
	columns: string[];
	dataRowCount: number;
}

// ExcelJS table ref format: "A4:D100"
function tableEndRow(ref: string): number {
	return parseInt(ref.match(/:?[A-Z]+(\d+)$/i)?.[1] ?? '1', 10);
}

function tableStartRow(ref: string): number {
	return parseInt(ref.match(/^[A-Z]+(\d+)/i)?.[1] ?? '1', 10);
}

function extendTableRef(ref: string, newEndRow: number): string {
	return ref.replace(/:\w+(\d+)$/, `:${ref.match(/:([A-Z]+)\d+$/i)?.[1] ?? 'A'}${newEndRow}`);
}

// Get all named tables from all sheets
export async function getWorkbookTables(buffer: Buffer): Promise<ExcelTableInfo[]> {
	const wb = await parseWorkbook(buffer);
	const result: ExcelTableInfo[] = [];

	for (const sheet of wb.worksheets) {
		const tables = (sheet as unknown as { tables: Record<string, { name: string; displayName?: string; ref: string; columns?: Array<{ name: string }> }> }).tables ?? {};
		for (const [, table] of Object.entries(tables)) {
			const sr = tableStartRow(table.ref);
			const er = tableEndRow(table.ref);
			const dataRowCount = Math.max(0, er - sr);
			const headers = getHeaders(sheet, sr);
			result.push({
				name: table.name,
				displayName: table.displayName ?? table.name,
				ref: table.ref,
				sheetName: sheet.name,
				columns: table.columns?.length ? table.columns.map(c => c.name) : headers,
				dataRowCount,
			});
		}
	}
	return result;
}

// Find a table by name across all sheets
async function findTableInWorkbook(
	wb: ExcelJS.Workbook,
	tableName: string,
): Promise<{ sheet: ExcelJS.Worksheet; table: { name: string; displayName?: string; ref: string; columns?: Array<{ name: string }> } }> {
	for (const sheet of wb.worksheets) {
		const tables = (sheet as unknown as { tables: Record<string, { name: string; displayName?: string; ref: string; columns?: Array<{ name: string }> }> }).tables ?? {};
		for (const [, table] of Object.entries(tables)) {
			if (table.name === tableName || table.displayName === tableName) {
				return { sheet, table };
			}
		}
	}
	throw new Error(`Table "${tableName}" not found. Use "List" to see available tables.`);
}

// Return column names of a named table
export async function getTableColumns(buffer: Buffer, tableName: string): Promise<string[]> {
	const wb = await parseWorkbook(buffer);
	const { sheet, table } = await findTableInWorkbook(wb, tableName);
	if (table.columns?.length) return table.columns.map(c => c.name);
	return getHeaders(sheet, tableStartRow(table.ref));
}

// Return data rows from a named table (optionally filtered by column values)
export async function getTableRows(
	buffer: Buffer,
	tableName: string,
	filters: Array<{ column: string; value: string }> = [],
): Promise<IDataObject[]> {
	const wb = await parseWorkbook(buffer);
	const { sheet, table } = await findTableInWorkbook(wb, tableName);
	const sr = tableStartRow(table.ref); // header row
	const er = tableEndRow(table.ref);
	const columns = table.columns?.length ? table.columns.map(c => c.name) : getHeaders(sheet, sr);

	const rows: IDataObject[] = [];
	for (let r = sr + 1; r <= er; r++) {
		const row = sheet.getRow(r);
		const obj: IDataObject = {};
		columns.forEach((col, i) => {
			obj[col] = cellValue(row.getCell(i + 1)) as IDataObject[string];
		});
		rows.push(obj);
	}

	if (filters.length === 0) return rows;
	return rows.filter(row =>
		filters.every(f => String(row[f.column] ?? '').toLowerCase() === f.value.toLowerCase()),
	);
}

// Append a row to a named table (extends table ref by 1)
export async function appendRowToTable(
	buffer: Buffer,
	tableName: string,
	rowData: IDataObject,
): Promise<Buffer> {
	const wb = await parseWorkbook(buffer);
	const { sheet, table } = await findTableInWorkbook(wb, tableName);
	const sr = tableStartRow(table.ref);
	const er = tableEndRow(table.ref);
	const columns = table.columns?.length ? table.columns.map(c => c.name) : getHeaders(sheet, sr);

	// Write new row after table end
	const newRowNum = er + 1;
	const newRow = sheet.getRow(newRowNum);
	columns.forEach((col, i) => {
		if (rowData[col] !== undefined) newRow.getCell(i + 1).value = rowData[col] as ExcelJS.CellValue;
	});
	newRow.commit();

	// Extend table ref
	table.ref = extendTableRef(table.ref, newRowNum);
	return saveWorkbook(wb);
}

// Update an existing row in a named table (rowIndex = 1-based data row)
export async function updateRowInTable(
	buffer: Buffer,
	tableName: string,
	rowIndex: number,
	rowData: IDataObject,
): Promise<Buffer> {
	const wb = await parseWorkbook(buffer);
	const { sheet, table } = await findTableInWorkbook(wb, tableName);
	const sr = tableStartRow(table.ref);
	const er = tableEndRow(table.ref);
	const dataRowCount = er - sr;

	if (rowIndex < 1 || rowIndex > dataRowCount) {
		throw new Error(`Row ${rowIndex} out of range — table has ${dataRowCount} data rows`);
	}

	const columns = table.columns?.length ? table.columns.map(c => c.name) : getHeaders(sheet, sr);
	const targetRow = sheet.getRow(sr + rowIndex);
	columns.forEach((col, i) => {
		if (rowData[col] !== undefined) targetRow.getCell(i + 1).value = rowData[col] as ExcelJS.CellValue;
	});
	targetRow.commit();
	return saveWorkbook(wb);
}

// Delete a row from a named table (rowIndex = 1-based data row)
export async function deleteRowFromTable(
	buffer: Buffer,
	tableName: string,
	rowIndex: number,
): Promise<Buffer> {
	const wb = await parseWorkbook(buffer);
	const { sheet, table } = await findTableInWorkbook(wb, tableName);
	const sr = tableStartRow(table.ref);
	const er = tableEndRow(table.ref);
	const dataRowCount = er - sr;

	if (rowIndex < 1 || rowIndex > dataRowCount) {
		throw new Error(`Row ${rowIndex} out of range — table has ${dataRowCount} data rows`);
	}

	sheet.spliceRows(sr + rowIndex, 1);
	table.ref = extendTableRef(table.ref, er - 1);
	return saveWorkbook(wb);
}

// ---------------------------------------------------------------------------
// Sheet write operations (ExcelJS — preserves all Excel structure)
// ---------------------------------------------------------------------------

// Update ALL table refs that cover the given sheet to extend by delta rows
function updateSheetTableRefs(sheet: ExcelJS.Worksheet, afterRow: number, delta: number): void {
	const tables = (sheet as unknown as { tables: Record<string, { ref: string }> }).tables ?? {};
	for (const [, table] of Object.entries(tables)) {
		const er = tableEndRow(table.ref);
		if (er >= afterRow) {
			table.ref = extendTableRef(table.ref, er + delta);
		}
	}
}

export async function appendRowXml(
	originalBuffer: Buffer,
	sheetName: string,
	globalHeaderIdx: number,  // 0-based
	colStart: number,
	colEnd: number,
	rowData: IDataObject,
	_wb: ExcelJS.Workbook,
): Promise<Buffer> {
	const wb = await parseWorkbook(originalBuffer);
	const sheet = wb.getWorksheet(sheetName);
	if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);

	// Read headers from configured header row
	const headerRow = globalHeaderIdx + 1; // 1-based
	const headers: string[] = [];
	for (let c = colStart + 1; c <= colEnd + 1; c++) {
		const val = cellValue(sheet.getRow(headerRow).getCell(c));
		headers.push(val ? String(val) : '');
	}

	// Find the last data row (start from last row of sheet or after last table row)
	let lastRow = sheet.lastRow?.number ?? headerRow;
	for (const [, table] of Object.entries((sheet as unknown as { tables: Record<string, { ref: string }> }).tables ?? {})) {
		lastRow = Math.max(lastRow, tableEndRow(table.ref));
	}
	const newRowNum = lastRow + 1;

	const newRow = sheet.getRow(newRowNum);
	headers.forEach((h, i) => {
		if (rowData[h] !== undefined) newRow.getCell(colStart + 1 + i).value = rowData[h] as ExcelJS.CellValue;
	});
	newRow.commit();

	// Extend all table refs that end at or after the header row
	updateSheetTableRefs(sheet, headerRow + 1, 1);

	return saveWorkbook(wb);
}

export async function updateRowXml(
	originalBuffer: Buffer,
	sheetName: string,
	globalHeaderIdx: number,
	colStart: number,
	colEnd: number,
	rowIndex: number,
	rowData: IDataObject,
	_wb: ExcelJS.Workbook,
): Promise<Buffer> {
	const wb = await parseWorkbook(originalBuffer);
	const sheet = wb.getWorksheet(sheetName);
	if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);

	const headerRow = globalHeaderIdx + 1;
	const headers: string[] = [];
	for (let c = colStart + 1; c <= colEnd + 1; c++) {
		const val = cellValue(sheet.getRow(headerRow).getCell(c));
		headers.push(val ? String(val) : '');
	}

	const targetRow = sheet.getRow(headerRow + rowIndex);
	headers.forEach((h, i) => {
		if (rowData[h] !== undefined) targetRow.getCell(colStart + 1 + i).value = rowData[h] as ExcelJS.CellValue;
	});
	targetRow.commit();
	return saveWorkbook(wb);
}

export async function deleteRowXml(
	originalBuffer: Buffer,
	sheetName: string,
	globalHeaderIdx: number,
	rowIndex: number,
): Promise<Buffer> {
	const wb = await parseWorkbook(originalBuffer);
	const sheet = wb.getWorksheet(sheetName);
	if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);

	const targetRowNum = globalHeaderIdx + 1 + rowIndex;
	sheet.spliceRows(targetRowNum, 1);
	updateSheetTableRefs(sheet, targetRowNum, -1);
	return saveWorkbook(wb);
}

export async function clearSheetXml(
	originalBuffer: Buffer,
	sheetName: string,
	globalHeaderIdx: number,
): Promise<Buffer> {
	const wb = await parseWorkbook(originalBuffer);
	const sheet = wb.getWorksheet(sheetName);
	if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);

	const firstDataRow = globalHeaderIdx + 2;
	const lastRow = sheet.lastRow?.number ?? firstDataRow;
	if (lastRow >= firstDataRow) {
		sheet.spliceRows(firstDataRow, lastRow - firstDataRow + 1);
	}
	updateSheetTableRefs(sheet, firstDataRow, -(lastRow - firstDataRow + 1));
	return saveWorkbook(wb);
}

// deleteRowFromSheet — used by Sheet resource Delete Row (legacy name kept for compat)
export function deleteRowFromSheet(
	_wb: ExcelJS.Workbook, _sheetName: string, _rowIndex: number, _headerRowIdx?: number,
): void { /* replaced by deleteRowXml */ }

// ---------------------------------------------------------------------------
// Load-options helpers
// ---------------------------------------------------------------------------

const SPREADSHEET_MIME = [
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	'application/vnd.ms-excel',
	'application/vnd.oasis.opendocument.spreadsheet',
	'text/csv',
];
const SPREADSHEET_EXT = ['xlsx', 'xls', 'ods', 'csv', 'xlsm'];

function isSpreadsheet(entry: DavEntry): boolean {
	const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
	return SPREADSHEET_MIME.includes(entry.contentType) || SPREADSHEET_EXT.includes(ext);
}

function entryToRel(entry: DavEntry, user: string): string {
	return ('/' + entry.href.replace(`/remote.php/dav/files/${encodeURIComponent(user)}/`, '')).replace('//', '/');
}

export async function getFolders(context: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const creds = await getCredentials(context);
	const result: INodePropertyOptions[] = [{ name: '/ (root)', value: '/' }];
	const rootEntries = await listDirectory(context, creds, '/', '1');

	await Promise.all(
		rootEntries.filter(e => e.isDirectory).map(async dir => {
			const rel = entryToRel(dir, creds.user);
			result.push({ name: `📁 ${dir.name}`, value: rel });
			try {
				const subEntries = await listDirectory(context, creds, rel, '1');
				for (const sub of subEntries.filter(e => e.isDirectory)) {
					result.push({ name: `　└ ${sub.name}  (${dir.name})`, value: entryToRel(sub, creds.user) });
				}
			} catch { /* skip inaccessible */ }
		}),
	);
	return result;
}

export async function getSpreadsheetFiles(context: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const creds = await getCredentials(context);
	const folderPath = (context.getNodeParameter('folderPath', '/') as string) || '/';
	const entries = await listDirectory(context, creds, folderPath, '1');
	const files = entries
		.filter(e => !e.isDirectory && isSpreadsheet(e))
		.map(e => ({ name: e.name, value: entryToRel(e, creds.user) }))
		.sort((a, b) => a.name.localeCompare(b.name));
	return files;
}

export async function getSheetsForFile(context: ILoadOptionsFunctions, filePath: string): Promise<INodePropertyOptions[]> {
	const creds = await getCredentials(context);
	const buffer = await downloadFile(context, creds, filePath);
	const wb = await parseWorkbook(buffer);
	return wb.worksheets.map(ws => ({ name: ws.name, value: ws.name }));
}

export async function getTablesForFile(context: ILoadOptionsFunctions, filePath: string): Promise<INodePropertyOptions[]> {
	const creds = await getCredentials(context);
	const buffer = await downloadFile(context, creds, filePath);
	const tables = await getWorkbookTables(buffer);

	if (tables.length === 0) {
		return [{ name: '⚠ Aucun tableau Excel nommé — utilisez Insert → Tableau dans Excel, ou passez en mode "By Name"', value: '' }];
	}
	return tables.map(t => ({
		name: `${t.displayName}  [${t.sheetName} · ${t.ref} · ${t.dataRowCount} rows]`,
		value: t.name,
	}));
}

export async function searchSpreadsheetFiles(context: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
	const creds = await getCredentials(context);
	const results: INodeListSearchResult['results'] = [];

	const rootEntries = await listDirectory(context, creds, '/', '1');
	for (const e of rootEntries) {
		if (!e.isDirectory && isSpreadsheet(e)) {
			if (!filter || e.name.toLowerCase().includes(filter.toLowerCase()))
				results.push({ name: e.name, value: entryToRel(e, creds.user) });
		}
	}
	await Promise.all(rootEntries.filter(e => e.isDirectory).map(async dir => {
		try {
			const sub = await listDirectory(context, creds, entryToRel(dir, creds.user), '1');
			for (const e of sub) {
				if (!e.isDirectory && isSpreadsheet(e) && (!filter || e.name.toLowerCase().includes(filter.toLowerCase())))
					results.push({ name: `${e.name}  (${dir.name})`, value: entryToRel(e, creds.user) });
			}
		} catch { /* skip */ }
	}));
	results.sort((a, b) => String(a.name).localeCompare(String(b.name)));
	return { results };
}

export async function searchSheetsForFile(context: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
	const mode = context.getNodeParameter('filePathMode', 'list') as string;
	const filePath = mode === 'list' ? (context.getNodeParameter('filePathFromList', '') as string) : (context.getNodeParameter('filePath', '') as string);
	if (!filePath) return { results: [] };
	const creds = await getCredentials(context);
	const buffer = await downloadFile(context, creds, filePath);
	const wb = await parseWorkbook(buffer);
	return {
		results: wb.worksheets
			.filter(ws => !filter || ws.name.toLowerCase().includes(filter.toLowerCase()))
			.map(ws => ({ name: ws.name, value: ws.name })),
	};
}

export async function searchTablesForFile(context: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
	const mode = context.getNodeParameter('filePathMode', 'list') as string;
	const filePath = mode === 'list' ? (context.getNodeParameter('filePathFromList', '') as string) : (context.getNodeParameter('filePath', '') as string);
	if (!filePath) return { results: [] };
	const creds = await getCredentials(context);
	const buffer = await downloadFile(context, creds, filePath);
	const tables = await getWorkbookTables(buffer);
	return {
		results: tables
			.filter(t => !filter || t.displayName.toLowerCase().includes(filter.toLowerCase()))
			.map(t => ({
				name: `${t.displayName}  [${t.sheetName} · ${t.ref} · ${t.dataRowCount} rows]`,
				value: t.name,
			})),
	};
}
