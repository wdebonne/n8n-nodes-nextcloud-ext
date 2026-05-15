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
import JSZip from 'jszip';
import os from 'os';
import fs from 'fs';
import path from 'path';
const XlsxPopulate = require('xlsx-populate') as {
	fromDataAsync(data: Buffer): Promise<XlsxPopulateWorkbook>;
};
interface XlsxPopulateWorkbook {
	sheet(name: string): XlsxPopulateSheet | undefined;
	outputAsync(): Promise<Buffer>;
}
interface XlsxPopulateSheet {
	cell(row: number, col: number): XlsxPopulateCell;
	usedRange(): { forEach(fn: (cell: XlsxPopulateCell) => void): void } | undefined;
}
interface XlsxPopulateCell {
	value(): unknown;
	value(v: unknown): XlsxPopulateCell;
	style(names: string[]): Record<string, unknown>;
	style(stylesObj: Record<string, unknown>): XlsxPopulateCell;
	rowNumber(): number;
	columnNumber(): number;
}

// Style properties to copy when appending a new row
const STYLE_PROPS = [
	'horizontalAlignment', 'verticalAlignment', 'wrapText', 'shrinkToFit', 'textRotation',
	'bold', 'italic', 'underline', 'strikethrough',
	'fontSize', 'fontFamily', 'fontColor',
	'fill', 'leftBorder', 'rightBorder', 'topBorder', 'bottomBorder', 'diagonalBorder',
	'numberFormat',
];

function copyRowStyle(
	sheet: XlsxPopulateSheet,
	fromRow: number,
	toRow: number,
	colStart: number,
	colEnd: number,
): void {
	for (let c = colStart; c <= colEnd; c++) {
		try {
			const styles = sheet.cell(fromRow, c).style(STYLE_PROPS);
			sheet.cell(toRow, c).style(styles);
		} catch { /* skip if cell has no style */ }
	}
}

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

// ---------------------------------------------------------------------------
// Table ref helpers
// ---------------------------------------------------------------------------

function tableEndRow(ref: string): number {
	return parseInt(ref.match(/:?[A-Z]+(\d+)$/i)?.[1] ?? '1', 10);
}

function tableStartRow(ref: string): number {
	return parseInt(ref.match(/^[A-Z]+(\d+)/i)?.[1] ?? '1', 10);
}

function extendTableRef(ref: string, newEndRow: number): string {
	return ref.replace(/:\w+(\d+)$/, `:${ref.match(/:([A-Z]+)\d+$/i)?.[1] ?? 'A'}${newEndRow}`);
}

function patchTableRef(tableXml: string, newRef: string): string {
	return tableXml
		.replace(/(<table\b[^>]*\s)ref="[^"]*"/i, `$1ref="${newRef}"`)
		.replace(/(<autoFilter\b[^>]*\s)ref="[^"]*"/i, `$1ref="${newRef}"`);
}

// ---------------------------------------------------------------------------
// Named table detection — ZIP-based (reads XML directly, always reliable)
// ---------------------------------------------------------------------------

interface ZipTable {
	name: string;
	displayName: string;
	ref: string;
	sheetName: string;
	zipPath: string;
	columns: string[];
}

const zipXmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function findSheetForRef(wb: ExcelJS.Workbook, ref: string): string | undefined {
	try {
		const sr = tableStartRow(ref);
		const sc = ref.match(/^([A-Z]+)/i)?.[1] ?? 'A';
		for (const sheet of wb.worksheets) {
			const cell = sheet.getCell(`${sc}${sr}`);
			if (cell.value !== null && cell.value !== undefined && cell.value !== '') {
				return sheet.name;
			}
		}
	} catch { /* ignore */ }
	return wb.worksheets[0]?.name;
}

async function extractTablesFromZip(buffer: Buffer, wb: ExcelJS.Workbook): Promise<ZipTable[]> {
	const tables: ZipTable[] = [];
	let zip: InstanceType<typeof JSZip>;
	try {
		zip = await JSZip.loadAsync(buffer);
	} catch { return tables; }

	// Find all xl/tables/*.xml files
	const tableFilePaths = Object.keys(zip.files).filter(p => /^xl[/\\]tables[/\\].+\.xml$/i.test(p));
	if (tableFilePaths.length === 0) return tables;

	// Build tableZipPath → sheetName via worksheet _rels
	const tablePathToSheet: Record<string, string> = {};
	const rIdToSheetName: Record<string, string> = {};

	const wbXml = await zip.file('xl/workbook.xml')?.async('text');
	const wbRelsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('text');

	if (wbXml && wbRelsXml) {
		const wb2 = zipXmlParser.parse(wbXml);
		const sheetNodes = (() => { const s = wb2?.workbook?.sheets?.sheet; return s ? (Array.isArray(s) ? s : [s]) : []; })() as Record<string, string>[];
		for (const s of sheetNodes) {
			const rId = s['@_r:id'] || s['@_r:Id'] || ''; if (rId) rIdToSheetName[rId] = s['@_name'] || '';
		}
		const wbRels2 = zipXmlParser.parse(wbRelsXml);
		const relNodes = (() => { const r = wbRels2?.Relationships?.Relationship; return r ? (Array.isArray(r) ? r : [r]) : []; })() as Record<string, string>[];
		const wsFileToSheetName: Record<string, string> = {};
		for (const r of relNodes) {
			if ((r['@_Type'] || '').includes('/worksheet')) {
				const file = (r['@_Target'] || '').split('/').pop()?.toLowerCase() ?? '';
				const name = rIdToSheetName[r['@_Id']] ?? '';
				if (file && name) wsFileToSheetName[file] = name;
			}
		}
		for (const zipPath of Object.keys(zip.files)) {
			const m = zipPath.match(/xl[/\\]worksheets[/\\]_rels[/\\](.+\.xml)\.rels$/i);
			if (!m) continue;
			const sheetName = wsFileToSheetName[m[1].toLowerCase()];
			if (!sheetName) continue;
			const relsXml = await zip.file(zipPath)?.async('text');
			if (!relsXml) continue;
			const rels2 = zipXmlParser.parse(relsXml);
			const rNodes = (() => { const r = rels2?.Relationships?.Relationship; return r ? (Array.isArray(r) ? r : [r]) : []; })() as Record<string, string>[];
			for (const r of rNodes) {
				if (!(r['@_Type'] || '').includes('/table')) continue;
				const resolved = ('xl/' + (r['@_Target'] || '').replace(/^\.\.\//, '')).toLowerCase();
				tablePathToSheet[resolved] = sheetName;
			}
		}
	}

	// Parse each table XML
	for (const tableZipPath of tableFilePaths) {
		const tableXml = await zip.file(tableZipPath)?.async('text');
		if (!tableXml) continue;
		const tbl = zipXmlParser.parse(tableXml)?.table as Record<string, unknown> | undefined;
		if (!tbl) continue;

		const name = String(tbl['@_name'] || '');
		const displayName = String(tbl['@_displayName'] || name);
		const ref = String(tbl['@_ref'] || '');
		if (!name || !ref) continue;

		const sheetName = tablePathToSheet[tableZipPath.toLowerCase()] ?? findSheetForRef(wb, ref);
		if (!sheetName) continue;

		// Read column names from actual header cells (most reliable)
		const sheet = wb.getWorksheet(sheetName);
		const columns: string[] = [];
		if (sheet) {
			const sr = tableStartRow(ref);
			const headerRow = sheet.getRow(sr);
			// Probe up to 5 rows to find the one with most filled cells
			let bestRow = headerRow;
			let bestCount = 0;
			for (let offset = 0; offset <= Math.min(4, tableEndRow(ref) - sr); offset++) {
				const row = sheet.getRow(sr + offset);
				let count = 0;
				row.eachCell({ includeEmpty: false }, () => count++);
				if (count > bestCount) { bestCount = count; bestRow = row; }
			}
			bestRow.eachCell({ includeEmpty: false }, cell => {
				const v = cellValue(cell);
				if (v) columns.push(String(v));
			});
		}

		tables.push({ name, displayName, ref, sheetName, zipPath: tableZipPath, columns });
	}

	return tables;
}

// ---------------------------------------------------------------------------
// Public table API
// ---------------------------------------------------------------------------

export async function getWorkbookTables(buffer: Buffer): Promise<ExcelTableInfo[]> {
	const wb = await parseWorkbook(buffer);
	const zipTables = await extractTablesFromZip(buffer, wb);
	return zipTables.map(t => ({
		name: t.name,
		displayName: t.displayName,
		ref: t.ref,
		sheetName: t.sheetName,
		columns: t.columns,
		dataRowCount: Math.max(0, tableEndRow(t.ref) - tableStartRow(t.ref)),
	}));
}

export async function getTableColumns(buffer: Buffer, tableName: string): Promise<string[]> {
	const wb = await parseWorkbook(buffer);
	const tables = await extractTablesFromZip(buffer, wb);
	const t = tables.find(x => x.name === tableName || x.displayName === tableName);
	if (!t) throw new Error(`Table "${tableName}" not found`);
	return t.columns;
}

export async function getTableRows(
	buffer: Buffer,
	tableName: string,
	filters: Array<{ column: string; value: string }> = [],
): Promise<IDataObject[]> {
	const wb = await parseWorkbook(buffer);
	const tables = await extractTablesFromZip(buffer, wb);
	const t = tables.find(x => x.name === tableName || x.displayName === tableName);
	if (!t) throw new Error(`Table "${tableName}" not found`);

	const sheet = wb.getWorksheet(t.sheetName);
	if (!sheet) throw new Error(`Sheet "${t.sheetName}" not found`);

	const sr = tableStartRow(t.ref);
	const er = tableEndRow(t.ref);
	const rows: IDataObject[] = [];

	for (let r = sr + 1; r <= er; r++) {
		const row = sheet.getRow(r);
		const obj: IDataObject = {};
		t.columns.forEach((col, i) => {
			obj[col] = cellValue(row.getCell(i + 1)) as IDataObject[string];
		});
		rows.push(obj);
	}

	if (filters.length === 0) return rows;
	return rows.filter(row => filters.every(f => String(row[f.column] ?? '').toLowerCase() === f.value.toLowerCase()));
}

// Table write: xlsx-populate for cells + JSZip to patch table XML ref
// xlsx-populate preserves the original ZIP structure (no file reconstruction)
async function writeTableWithPopulate(
	originalBuffer: Buffer,
	sheetName: string,
	tableZipPath: string,
	newRef: string,
	modifyCells: (sheet: XlsxPopulateSheet) => void,
): Promise<Buffer> {
	// Use xlsx-populate to set cell values (preserves everything else)
	const xlWb = await XlsxPopulate.fromDataAsync(originalBuffer);
	const sheet = xlWb.sheet(sheetName);
	if (sheet) modifyCells(sheet);
	const newWbBuffer = await xlWb.outputAsync();

	// Patch only the table XML ref in the output
	const newZip = await JSZip.loadAsync(newWbBuffer);
	const tableXml = await newZip.file(tableZipPath)?.async('text');
	if (tableXml) {
		newZip.file(tableZipPath, patchTableRef(tableXml, newRef));
	}

	return Buffer.from(await newZip.generateAsync({
		type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 },
	}));
}

export async function appendRowToTable(
	buffer: Buffer,
	tableName: string,
	rowData: IDataObject,
): Promise<Buffer> {
	const wb = await parseWorkbook(buffer); // ExcelJS for reading table metadata
	const tables = await extractTablesFromZip(buffer, wb);
	const t = tables.find(x => x.name === tableName || x.displayName === tableName);
	if (!t) throw new Error(`Table "${tableName}" not found`);

	const er = tableEndRow(t.ref);
	const newRowNum = er + 1;

	return writeTableWithPopulate(buffer, t.sheetName, t.zipPath, extendTableRef(t.ref, newRowNum), sheet => {
		// Copy styles from last data row so the new row matches existing formatting
		copyRowStyle(sheet, er, newRowNum, 1, t.columns.length);
		t.columns.forEach((col, i) => {
			if (rowData[col] !== undefined) sheet.cell(newRowNum, i + 1).value(rowData[col]);
		});
	});
}

// Update an existing row in a named table (rowIndex = 1-based data row)
export async function updateRowInTable(
	buffer: Buffer,
	tableName: string,
	rowIndex: number,
	rowData: IDataObject,
): Promise<Buffer> {
	const wb = await parseWorkbook(buffer);
	const tables = await extractTablesFromZip(buffer, wb);
	const t = tables.find(x => x.name === tableName || x.displayName === tableName);
	if (!t) throw new Error(`Table "${tableName}" not found`);

	const sr = tableStartRow(t.ref);
	const er = tableEndRow(t.ref);
	const dataRowCount = er - sr;
	if (rowIndex < 1 || rowIndex > dataRowCount) throw new Error(`Row ${rowIndex} out of range — table has ${dataRowCount} data rows`);

	return writeTableWithPopulate(buffer, t.sheetName, t.zipPath, t.ref, sheet => {
		t.columns.forEach((col, i) => {
			if (rowData[col] !== undefined) sheet.cell(sr + rowIndex, i + 1).value(rowData[col]);
		});
	});
}

// Delete a row from a named table (rowIndex = 1-based data row)
export async function deleteRowFromTable(
	buffer: Buffer,
	tableName: string,
	rowIndex: number,
): Promise<Buffer> {
	const wb = await parseWorkbook(buffer);
	const tables = await extractTablesFromZip(buffer, wb);
	const t = tables.find(x => x.name === tableName || x.displayName === tableName);
	if (!t) throw new Error(`Table "${tableName}" not found`);

	const sr = tableStartRow(t.ref);
	const er = tableEndRow(t.ref);
	const dataRowCount = er - sr;
	if (rowIndex < 1 || rowIndex > dataRowCount) throw new Error(`Row ${rowIndex} out of range — table has ${dataRowCount} data rows`);

	const maxCol = t.columns.length;
	// Shift rows up, then clear last row
	return writeTableWithPopulate(buffer, t.sheetName, t.zipPath, extendTableRef(t.ref, er - 1), sheet => {
		for (let r = sr + rowIndex; r < er; r++) {
			for (let c = 1; c <= maxCol; c++) {
				sheet.cell(r, c).value(sheet.cell(r + 1, c).value());
			}
		}
		for (let c = 1; c <= maxCol; c++) sheet.cell(er, c).value(null);
	});
}

// ---------------------------------------------------------------------------
// Sheet write operations — xlsx-populate (modifies only the changed cells,
// preserves ALL original XML including tables, styles, merged cells, etc.)
// ---------------------------------------------------------------------------

function xlsxLastRow(sheet: XlsxPopulateSheet, minRow: number): number {
	let last = minRow;
	sheet.usedRange()?.forEach(cell => { if (cell.rowNumber() > last) last = cell.rowNumber(); });
	return last;
}

function xlsxMaxCol(sheet: XlsxPopulateSheet): number {
	let max = 1;
	sheet.usedRange()?.forEach(cell => { if (cell.columnNumber() > max) max = cell.columnNumber(); });
	return max;
}

function xlsxHeaders(sheet: XlsxPopulateSheet, headerRowNum: number, colStart: number, colEnd: number): string[] {
	const headers: string[] = [];
	for (let c = colStart + 1; c <= colEnd + 1; c++) {
		const v = sheet.cell(headerRowNum, c).value();
		headers.push(v !== null && v !== undefined ? String(v) : '');
	}
	return headers;
}

export async function appendRowXml(
	originalBuffer: Buffer,
	sheetName: string,
	globalHeaderIdx: number,
	colStart: number,
	colEnd: number,
	rowData: IDataObject,
	_wb: ExcelJS.Workbook,
): Promise<Buffer> {
	const wb = await XlsxPopulate.fromDataAsync(originalBuffer);
	const sheet = wb.sheet(sheetName);
	if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);

	const headerRowNum = globalHeaderIdx + 1; // 1-based
	const headers = xlsxHeaders(sheet, headerRowNum, colStart, colEnd);
	const newRowNum = xlsxLastRow(sheet, headerRowNum) + 1;

	// Copy styles from the row above so the new row matches the existing formatting
	copyRowStyle(sheet, newRowNum - 1, newRowNum, colStart + 1, colEnd + 1);

	headers.forEach((h, i) => {
		if (rowData[h] !== undefined) sheet.cell(newRowNum, colStart + 1 + i).value(rowData[h]);
	});

	return wb.outputAsync();
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
	const wb = await XlsxPopulate.fromDataAsync(originalBuffer);
	const sheet = wb.sheet(sheetName);
	if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);

	const headerRowNum = globalHeaderIdx + 1;
	const headers = xlsxHeaders(sheet, headerRowNum, colStart, colEnd);
	const targetRowNum = headerRowNum + rowIndex;

	headers.forEach((h, i) => {
		if (rowData[h] !== undefined) sheet.cell(targetRowNum, colStart + 1 + i).value(rowData[h]);
	});

	return wb.outputAsync();
}

export async function deleteRowXml(
	originalBuffer: Buffer,
	sheetName: string,
	globalHeaderIdx: number,
	rowIndex: number,
): Promise<Buffer> {
	const wb = await XlsxPopulate.fromDataAsync(originalBuffer);
	const sheet = wb.sheet(sheetName);
	if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);

	const targetRowNum = globalHeaderIdx + 1 + rowIndex;
	const lastRowNum = xlsxLastRow(sheet, targetRowNum);
	const maxCol = xlsxMaxCol(sheet);

	// Shift all rows after target up by 1
	for (let r = targetRowNum; r < lastRowNum; r++) {
		for (let c = 1; c <= maxCol; c++) {
			sheet.cell(r, c).value(sheet.cell(r + 1, c).value());
		}
	}
	// Clear the vacated last row
	for (let c = 1; c <= maxCol; c++) sheet.cell(lastRowNum, c).value(null);

	return wb.outputAsync();
}

export async function clearSheetXml(
	originalBuffer: Buffer,
	sheetName: string,
	globalHeaderIdx: number,
): Promise<Buffer> {
	const wb = await XlsxPopulate.fromDataAsync(originalBuffer);
	const sheet = wb.sheet(sheetName);
	if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);

	const firstDataRowNum = globalHeaderIdx + 2;
	const lastRowNum = xlsxLastRow(sheet, firstDataRowNum);
	const maxCol = xlsxMaxCol(sheet);

	for (let r = firstDataRowNum; r <= lastRowNum; r++) {
		for (let c = 1; c <= maxCol; c++) sheet.cell(r, c).value(null);
	}

	return wb.outputAsync();
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

// ---------------------------------------------------------------------------
// PDF helpers
// ---------------------------------------------------------------------------

function isPdfFile(entry: DavEntry): boolean {
	return entry.name.toLowerCase().endsWith('.pdf');
}

export async function getPdfFiles(context: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const creds = await getCredentials(context);
	const folderPath = (context.getNodeParameter('folderPath', '/') as string) || '/';
	const entries = await listDirectory(context, creds, folderPath, '1');
	return entries
		.filter(e => !e.isDirectory && isPdfFile(e))
		.map(e => ({ name: e.name, value: entryToRel(e, creds.user) }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export async function searchPdfFiles(context: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
	const creds = await getCredentials(context);
	const results: INodeListSearchResult['results'] = [];
	const rootEntries = await listDirectory(context, creds, '/', '1');
	for (const e of rootEntries) {
		if (!e.isDirectory && isPdfFile(e)) {
			if (!filter || e.name.toLowerCase().includes(filter.toLowerCase()))
				results.push({ name: e.name, value: entryToRel(e, creds.user) });
		}
	}
	await Promise.all(rootEntries.filter(e => e.isDirectory).map(async dir => {
		try {
			const sub = await listDirectory(context, creds, entryToRel(dir, creds.user), '1');
			for (const e of sub) {
				if (!e.isDirectory && isPdfFile(e) && (!filter || e.name.toLowerCase().includes(filter.toLowerCase())))
					results.push({ name: `${e.name}  (${dir.name})`, value: entryToRel(e, creds.user) });
			}
		} catch { /* skip inaccessible */ }
	}));
	results.sort((a, b) => String(a.name).localeCompare(String(b.name)));
	return { results };
}

// ---------------------------------------------------------------------------
// DOCX template helpers — Carbone + JSZip
// ---------------------------------------------------------------------------

interface CarboneInstance {
	render(
		templatePath: string,
		data: Record<string, unknown>,
		options: Record<string, unknown>,
		callback: (err: Error | null, result: Buffer) => void,
	): void;
	render(
		templatePath: string,
		data: Record<string, unknown>,
		callback: (err: Error | null, result: Buffer) => void,
	): void;
}

const carbone = require('carbone') as CarboneInstance;

const DOC_EXT = ['docx', 'odt'];

function isDocFile(entry: DavEntry): boolean {
	const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
	return DOC_EXT.includes(ext);
}

export async function getDocFiles(context: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const creds = await getCredentials(context);
	const folderPath = (context.getNodeParameter('folderPath', '/') as string) || '/';
	const entries = await listDirectory(context, creds, folderPath, '1');
	return entries
		.filter(e => !e.isDirectory && isDocFile(e))
		.map(e => ({ name: e.name, value: entryToRel(e, creds.user) }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export async function searchDocFiles(context: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
	const creds = await getCredentials(context);
	const results: INodeListSearchResult['results'] = [];
	const rootEntries = await listDirectory(context, creds, '/', '1');
	for (const e of rootEntries) {
		if (!e.isDirectory && isDocFile(e)) {
			if (!filter || e.name.toLowerCase().includes(filter.toLowerCase()))
				results.push({ name: e.name, value: entryToRel(e, creds.user) });
		}
	}
	await Promise.all(rootEntries.filter(e => e.isDirectory).map(async dir => {
		try {
			const sub = await listDirectory(context, creds, entryToRel(dir, creds.user), '1');
			for (const e of sub) {
				if (!e.isDirectory && isDocFile(e) && (!filter || e.name.toLowerCase().includes(filter.toLowerCase())))
					results.push({ name: `${e.name}  (${dir.name})`, value: entryToRel(e, creds.user) });
			}
		} catch { /* skip inaccessible */ }
	}));
	results.sort((a, b) => String(a.name).localeCompare(String(b.name)));
	return { results };
}

// Extract {d.variable} placeholders from a DOCX/ODT buffer using JSZip
export async function extractCarboneVariables(buffer: Buffer): Promise<string[]> {
	const zip = await JSZip.loadAsync(buffer);
	const variables = new Set<string>();

	// Determine format: DOCX uses word/document.xml, ODT uses content.xml
	const isOdt = 'content.xml' in zip.files;
	const targetFiles = isOdt
		? ['content.xml']
		: Object.keys(zip.files).filter(f =>
			f === 'word/document.xml' ||
			/^word\/header\d*\.xml$/.test(f) ||
			/^word\/footer\d*\.xml$/.test(f),
		);

	// Regex matches {d.path}, {!d.path}, and {d.path:formatter}, {d.cond ? 'a' : 'b'}
	const carboneTagRe = /\{[!]?d\.([a-zA-Z_][\w.[\]]*?)(?:[?:!|][^}]*)?\}/g;

	for (const xmlFile of targetFiles) {
		try {
			const file = zip.file(xmlFile);
			if (!file) continue;
			let content = await file.async('string');
			// Normalize: join text runs split across XML tags (common in DOCX)
			content = content.replace(/<\/w:t>[\s\S]*?<w:t[^>]*>/g, '');
			for (const m of content.matchAll(carboneTagRe)) {
				const varPath = m[1].trim();
				if (varPath) variables.add(varPath);
			}
		} catch { /* skip */ }
	}

	return [...variables].sort();
}

// Render a Carbone template (DOCX/ODT buffer) with the given data.
// outputFormat: 'docx' (default) or 'pdf' (requires LibreOffice on the server)
export async function renderCarboneTemplate(
	buffer: Buffer,
	data: Record<string, unknown>,
	outputFormat: 'docx' | 'pdf' = 'docx',
): Promise<Buffer> {
	const tmpDir = os.tmpdir();
	const uid = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
	const inputPath = path.join(tmpDir, `nc_carbone_${uid}.docx`);

	try {
		fs.writeFileSync(inputPath, buffer);
		const options: Record<string, unknown> = outputFormat === 'pdf' ? { convertTo: 'pdf' } : {};
		return await new Promise<Buffer>((resolve, reject) => {
			carbone.render(inputPath, data, options, (err: Error | null, result: Buffer) => {
				if (err) reject(err);
				else resolve(result);
			});
		});
	} finally {
		try { fs.unlinkSync(inputPath); } catch { /* ignore cleanup errors */ }
	}
}

// Resolve an output Nextcloud path from folder + filename (normalises slashes)
export function buildOutputPath(folder: string, fileName: string): string {
	const base = (folder || '/').replace(/\/+$/, '');
	const name = fileName.replace(/^\/+/, '');
	return base === '' ? `/${name}` : `${base}/${name}`;
}
