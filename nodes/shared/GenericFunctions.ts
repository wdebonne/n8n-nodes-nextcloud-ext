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
import JSZip from 'jszip';
import * as xlsx from 'xlsx';

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
	const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });
	const parsed = parser.parse(xml);

	// Navigate the parsed object — the structure varies slightly per parser output
	const multistatus =
		parsed['d:multistatus'] ||
		parsed['D:multistatus'] ||
		parsed.multistatus ||
		{};

	const rawResponses =
		multistatus['d:response'] ||
		multistatus['D:response'] ||
		multistatus.response ||
		[];

	const responses = Array.isArray(rawResponses) ? rawResponses : [rawResponses];
	const baseDavPath = `/remote.php/dav/files/${encodeURIComponent(user)}/`;

	return responses.map((r: IDataObject): DavEntry => {
		const prop = extractProp(r);
		const href = String(
			r['d:href'] || r['D:href'] || r.href || '',
		);

		const relPath = href.startsWith(baseDavPath)
			? href.slice(baseDavPath.length)
			: href;

		const resourcetype = (prop['d:resourcetype'] || prop['D:resourcetype'] || prop.resourcetype || {}) as Record<string, unknown>;
		const isDirectory =
			typeof resourcetype === 'object' &&
			('d:collection' in resourcetype ||
				'D:collection' in resourcetype ||
				'collection' in resourcetype);

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
	const propstat =
		response['d:propstat'] ||
		response['D:propstat'] ||
		response.propstat ||
		{};
	const first = Array.isArray(propstat) ? propstat[0] : propstat;
	return (
		(first['d:prop'] as IDataObject) ||
		(first['D:prop'] as IDataObject) ||
		(first.prop as IDataObject) ||
		{}
	);
}

// ---------------------------------------------------------------------------
// Download a file as Buffer
// ---------------------------------------------------------------------------

export async function downloadFile(
	context: IExecuteFunctions | ILoadOptionsFunctions,
	creds: NextCloudCredentials,
	filePath: string,
): Promise<Buffer> {
	const url = davUrl(creds.serverUrl, creds.user, filePath);
	const response = await webdavRequest(context, 'GET', url, creds, {}, undefined, 'arraybuffer');

	if (response.statusCode >= 400) {
		throw new NodeApiError(context.getNode(), {
			message: `Download failed (${response.statusCode}) for path: ${filePath}`,
		});
	}
	return Buffer.from(response.body as unknown as ArrayBuffer);
}

// ---------------------------------------------------------------------------
// Upload a file (Buffer → WebDAV PUT)
// ---------------------------------------------------------------------------

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
		headers: {
			Authorization: authHeader(creds.user, creds.password),
			'Content-Type': contentType,
		},
		body: data,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};

	const response = await context.helpers.httpRequest(options);
	const status = response.statusCode as number;
	if (status >= 400) {
		throw new NodeApiError(context.getNode(), {
			message: `Upload failed (${status}) for path: ${filePath}`,
		});
	}
}

// ---------------------------------------------------------------------------
// Spreadsheet helpers (SheetJS / xlsx)
// ---------------------------------------------------------------------------

export function parseWorkbook(buffer: Buffer): xlsx.WorkBook {
	return xlsx.read(buffer, { type: 'buffer', cellDates: true });
}

export function serializeWorkbook(workbook: xlsx.WorkBook, ext: string): Buffer {
	const bookType = extToBookType(ext);
	const out = xlsx.write(workbook, { type: 'buffer', bookType, cellDates: true });
	return Buffer.from(out);
}

function extToBookType(ext: string): xlsx.BookType {
	const e = ext.toLowerCase().replace('.', '');
	const map: Record<string, xlsx.BookType> = {
		xlsx: 'xlsx',
		xlsm: 'xlsm',
		xls: 'xls',
		ods: 'ods',
		csv: 'csv',
	};
	return map[e] ?? 'xlsx';
}

export function getSheetNames(workbook: xlsx.WorkBook): string[] {
	return workbook.SheetNames;
}

export function sheetToRows(
	sheet: xlsx.WorkSheet,
	rawData = false,
): IDataObject[] {
	if (rawData) {
		const rows = xlsx.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' }) as string[][];
		return rows.map((row, i) => ({ __row: i + 1, ...row }));
	}
	return xlsx.utils.sheet_to_json<IDataObject>(sheet, { defval: '' });
}

export function getHeaders(sheet: xlsx.WorkSheet): string[] {
	const range = xlsx.utils.decode_range(sheet['!ref'] ?? 'A1');
	const headers: string[] = [];
	for (let col = range.s.c; col <= range.e.c; col++) {
		const cell = sheet[xlsx.utils.encode_cell({ r: range.s.r, c: col })];
		headers.push(cell ? String(cell.v) : `Column${col + 1}`);
	}
	return headers;
}

// Returns the row count (excluding header)
export function getDataRowCount(sheet: xlsx.WorkSheet): number {
	const range = xlsx.utils.decode_range(sheet['!ref'] ?? 'A1');
	return Math.max(0, range.e.r - range.s.r);
}

// Append a row to a sheet (mutates)
export function appendRowToSheet(
	sheet: xlsx.WorkSheet,
	rowData: IDataObject,
): void {
	const headers = getHeaders(sheet);
	const rowArray = headers.map((h) => rowData[h] ?? '');
	xlsx.utils.sheet_add_aoa(sheet, [rowArray], { origin: -1 });
}

// Update a row by 1-based data index (row 1 = first data row, after header)
export function updateRowInSheet(
	sheet: xlsx.WorkSheet,
	rowIndex: number,
	rowData: IDataObject,
): void {
	const headers = getHeaders(sheet);
	const range = xlsx.utils.decode_range(sheet['!ref'] ?? 'A1');
	const targetRow = range.s.r + rowIndex; // header row + rowIndex

	if (targetRow > range.e.r) {
		throw new Error(`Row ${rowIndex} does not exist (sheet has ${range.e.r - range.s.r} data rows)`);
	}

	headers.forEach((h, colIdx) => {
		if (rowData[h] !== undefined) {
			const cellAddr = xlsx.utils.encode_cell({ r: targetRow, c: range.s.c + colIdx });
			sheet[cellAddr] = { v: rowData[h], t: typeof rowData[h] === 'number' ? 'n' : 's' };
		}
	});
}

// Delete a row by 1-based data index, relative to headerRowIdx (0-based)
export function deleteRowFromSheet(
	workbook: xlsx.WorkBook,
	sheetName: string,
	rowIndex: number,
	headerRowIdx = 0,
): void {
	const sheet = workbook.Sheets[sheetName];
	const range = xlsx.utils.decode_range(sheet['!ref'] ?? 'A1');
	const targetRow = headerRowIdx + rowIndex; // 0-based absolute row
	const dataRowCount = range.e.r - headerRowIdx;

	if (rowIndex < 1 || rowIndex > dataRowCount) {
		throw new Error(`Row ${rowIndex} is out of range (${dataRowCount} data rows available)`);
	}

	// Shift rows up from targetRow
	for (let r = targetRow; r < range.e.r; r++) {
		for (let c = range.s.c; c <= range.e.c; c++) {
			const src = sheet[xlsx.utils.encode_cell({ r: r + 1, c })];
			const dst = xlsx.utils.encode_cell({ r, c });
			if (src) sheet[dst] = { ...src };
			else delete sheet[dst];
		}
	}
	// Clear last row
	for (let c = range.s.c; c <= range.e.c; c++) {
		delete sheet[xlsx.utils.encode_cell({ r: range.e.r, c })];
	}
	range.e.r -= 1;
	sheet['!ref'] = xlsx.utils.encode_range(range);
}

// ---------------------------------------------------------------------------
// Load-options helpers (file browser for n8n dropdowns)
// ---------------------------------------------------------------------------

function entryToRel(entry: DavEntry, user: string): string {
	return ('/' + entry.href.replace(
		`/remote.php/dav/files/${encodeURIComponent(user)}/`, '',
	)).replace('//', '/');
}

function isSpreadsheet(entry: DavEntry): boolean {
	const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
	return SPREADSHEET_MIME.includes(entry.contentType) || SPREADSHEET_EXT.includes(ext);
}

// List folders 2 levels deep for the Folder selector
export async function getFolders(context: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const creds = await getCredentials(context);
	const result: INodePropertyOptions[] = [{ name: '/ (root)', value: '/' }];

	const rootEntries = await listDirectory(context, creds, '/', '1');
	const rootDirs = rootEntries.filter((e) => e.isDirectory);

	await Promise.all(
		rootDirs.map(async (dir) => {
			const rel = entryToRel(dir, creds.user);
			result.push({ name: `📁 ${dir.name}`, value: rel });
			try {
				const subEntries = await listDirectory(context, creds, rel, '1');
				for (const sub of subEntries.filter((e) => e.isDirectory)) {
					result.push({
						name: `　└ ${sub.name}  (${dir.name})`,
						value: entryToRel(sub, creds.user),
					});
				}
			} catch { /* skip inaccessible */ }
		}),
	);

	return result;
}

// List spreadsheet files inside the folder chosen by the user
export async function getSpreadsheetFiles(
	context: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const creds = await getCredentials(context);
	// Read the folder the user selected — default to root
	const folderPath = (context.getNodeParameter('folderPath', '/') as string) || '/';

	const entries = await listDirectory(context, creds, folderPath, '1');
	const files: INodePropertyOptions[] = [];

	for (const e of entries) {
		if (!e.isDirectory && isSpreadsheet(e)) {
			files.push({ name: e.name, value: entryToRel(e, creds.user) });
		}
	}

	files.sort((a, b) => String(a.name).localeCompare(String(b.name)));
	return files;
}

export async function getSheetsForFile(
	context: ILoadOptionsFunctions,
	filePath: string,
): Promise<INodePropertyOptions[]> {
	const creds = await getCredentials(context);
	const buffer = await downloadFile(context, creds, filePath);
	const workbook = parseWorkbook(buffer);
	return workbook.SheetNames.map((name) => ({ name, value: name }));
}

// ---------------------------------------------------------------------------
// Searchable list methods (always shows search box, recursive file discovery)
// ---------------------------------------------------------------------------

const SPREADSHEET_MIME = [
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	'application/vnd.ms-excel',
	'application/vnd.oasis.opendocument.spreadsheet',
	'text/csv',
];
const SPREADSHEET_EXT = ['xlsx', 'xls', 'ods', 'csv', 'xlsm'];

// Search spreadsheet files — root + 1 level of sub-folders (safe, no Depth:infinity)
export async function searchSpreadsheetFiles(
	context: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const creds = await getCredentials(context);
	const results: INodeListSearchResult['results'] = [];

	const collectFiles = (entries: DavEntry[], folderPath: string) => {
		for (const entry of entries) {
			if (entry.isDirectory) continue;
			const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
			if (!SPREADSHEET_MIME.includes(entry.contentType) && !SPREADSHEET_EXT.includes(ext)) continue;
			if (filter && !entry.name.toLowerCase().includes(filter.toLowerCase())) continue;

			const rel = ('/' + entry.href.replace(
				`/remote.php/dav/files/${encodeURIComponent(creds.user)}/`, '',
			)).replace('//', '/');

			const displayName = folderPath === '/'
				? entry.name
				: `${entry.name}  (${folderPath})`;

			results.push({ name: displayName, value: rel });
		}
	};

	// Level 0 — root
	const rootEntries = await listDirectory(context, creds, '/', '1');
	collectFiles(rootEntries, '/');

	// Level 1 — direct sub-folders of root
	const subDirs = rootEntries.filter((e) => e.isDirectory);
	await Promise.all(
		subDirs.map(async (dir) => {
			const rel = ('/' + dir.href.replace(
				`/remote.php/dav/files/${encodeURIComponent(creds.user)}/`, '',
			)).replace('//', '/');
			try {
				const subEntries = await listDirectory(context, creds, rel, '1');
				collectFiles(subEntries, rel);
			} catch {
				// Skip inaccessible sub-folders silently
			}
		}),
	);

	results.sort((a, b) => {
		const aDepth = String(a.value).split('/').length;
		const bDepth = String(b.value).split('/').length;
		return aDepth !== bDepth ? aDepth - bDepth : String(a.name).localeCompare(String(b.name));
	});

	return { results };
}

// Search sheet names within the currently selected file
export async function searchSheetsForFile(
	context: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const mode = context.getNodeParameter('filePathMode', 'list') as string;
	const filePath = mode === 'list'
		? (context.getNodeParameter('filePathFromList', '') as string)
		: (context.getNodeParameter('filePath', '') as string);

	if (!filePath) return { results: [] };

	const creds = await getCredentials(context);
	const buffer = await downloadFile(context, creds, filePath);
	const workbook = parseWorkbook(buffer);

	const results = workbook.SheetNames
		.filter((name) => !filter || name.toLowerCase().includes(filter.toLowerCase()))
		.map((name) => ({ name, value: name }));

	return { results };
}

// Search table names within the currently selected file
export async function searchTablesForFile(
	context: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const mode = context.getNodeParameter('filePathMode', 'list') as string;
	const filePath = mode === 'list'
		? (context.getNodeParameter('filePathFromList', '') as string)
		: (context.getNodeParameter('filePath', '') as string);

	if (!filePath) return { results: [] };

	const creds = await getCredentials(context);
	const buffer = await downloadFile(context, creds, filePath);
	const tables = await extractTablesFromZip(buffer);

	const results = tables
		.filter((t) => !filter || t.displayName.toLowerCase().includes(filter.toLowerCase()))
		.map((t) => {
			const range = xlsx.utils.decode_range(t.ref);
			const dataRows = Math.max(0, range.e.r - range.s.r);
			return {
				name: `${t.displayName}  [${t.sheetName} · ${t.ref} · ${dataRows} rows]`,
				value: t.name,
			};
		});

	return { results };
}

// ---------------------------------------------------------------------------
// Named Excel Table helpers — JSZip-based (SheetJS community ignores table XML)
// ---------------------------------------------------------------------------

export interface ExcelTableInfo {
	name: string;
	displayName: string;
	ref: string;
	sheetName: string;
	columns: string[];
	dataRowCount: number;
}

// Internal ZIP-level table descriptor
interface ZipTable {
	name: string;
	displayName: string;
	ref: string;
	sheetName: string;
	zipPath: string; // e.g. "xl/tables/table1.xml"
	columns: string[];
}

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

// Read a single row of header values from a sheet
function readRowCells(sheet: xlsx.WorkSheet, row: number, colStart: number, colEnd: number): string[] {
	const headers: string[] = [];
	for (let c = colStart; c <= colEnd; c++) {
		const cell = sheet[xlsx.utils.encode_cell({ r: row, c })];
		headers.push(cell ? String(cell.v).trim() : '');
	}
	return headers;
}

// Find the best header row in the table range.
// Scans up to 5 rows deep: accepts the first row where at least 75% of cells are non-empty.
// This handles the common pattern where row 1 is a title ("REGISTRE DES ARRÊTÉS")
// and the real column headers (N°, INTITULÉ…) are a few rows below.
function columnsFromCells(workbook: xlsx.WorkBook, sheetName: string, ref: string): string[] {
	const sheet = workbook.Sheets[sheetName];
	if (!sheet) return [];

	const range = xlsx.utils.decode_range(ref);
	const totalCols = range.e.c - range.s.c + 1;
	const maxProbe = Math.min(5, range.e.r - range.s.r);

	for (let offset = 0; offset <= maxProbe; offset++) {
		const rawHeaders = readRowCells(sheet, range.s.r + offset, range.s.c, range.e.c);
		const filledCount = rawHeaders.filter((v) => v !== '').length;

		// Accept this row if at most 25% of cells are empty
		if (filledCount >= Math.ceil(totalCols * 0.75)) {
			return rawHeaders.map((v, i) => v || `Column${i + 1}`);
		}
	}

	// Fallback: first row regardless
	return readRowCells(sheet, range.s.r, range.s.c, range.e.c)
		.map((v, i) => v || `Column${i + 1}`);
}

// Find which SheetJS sheet contains cells at a given ref range
function findSheetForRef(workbook: xlsx.WorkBook, ref: string): string | undefined {
	try {
		const range = xlsx.utils.decode_range(ref);
		// Check if the first cell of the range has a value in any sheet
		for (const sheetName of workbook.SheetNames) {
			const sheet = workbook.Sheets[sheetName];
			if (!sheet) continue;
			// Check multiple cells in the first row of the ref
			for (let c = range.s.c; c <= Math.min(range.e.c, range.s.c + 3); c++) {
				const cell = sheet[xlsx.utils.encode_cell({ r: range.s.r, c })];
				if (cell && cell.v !== undefined && cell.v !== '') return sheetName;
			}
		}
	} catch { /* ignore */ }
	return workbook.SheetNames[0]; // fallback to first sheet
}

// Reads all named tables directly from the xlsx ZIP.
// Finds xl/tables/*.xml files first, then resolves sheet ownership two ways:
// 1. Via worksheet _rels files (standard)
// 2. Via cell content matching (fallback when relationships are missing/broken)
async function extractTablesFromZip(buffer: Buffer): Promise<ZipTable[]> {
	const workbook = parseWorkbook(buffer);

	let zip: import('jszip');
	try {
		zip = await JSZip.loadAsync(buffer);
	} catch {
		return []; // not a valid ZIP / not an xlsx file
	}

	const tables: ZipTable[] = [];

	// --- Step 1: Find ALL table XML files in the ZIP ---
	const tableFilePaths = Object.keys(zip.files).filter(
		(p) => /^xl[/\\]tables[/\\].+\.xml$/i.test(p),
	);
	if (tableFilePaths.length === 0) return tables;

	// --- Step 2: Try to build tableZipPath → sheetName via _rels (best effort) ---
	const tablePathToSheet: Record<string, string> = {};

	// 2a. workbook.xml → rId → sheetName
	const rIdToSheetName: Record<string, string> = {};
	const wbXml = await zip.file('xl/workbook.xml')?.async('text')
		?? await zip.file('xl/Workbook.xml')?.async('text');
	if (wbXml) {
		const wb = xmlParser.parse(wbXml);
		const nodes = (() => { const s = wb?.workbook?.sheets?.sheet; return s ? (Array.isArray(s) ? s : [s]) : []; })() as Record<string, string>[];
		for (const s of nodes) {
			const rId = s['@_r:id'] || s['@_r:Id'] || '';
			if (rId) rIdToSheetName[rId] = s['@_name'] || '';
		}
	}

	// 2b. workbook.xml.rels → rId → worksheet filename
	const wsFileToSheetName: Record<string, string> = {};
	const wbRelsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('text')
		?? await zip.file('xl/_rels/Workbook.xml.rels')?.async('text');
	if (wbRelsXml) {
		const rels = xmlParser.parse(wbRelsXml);
		const nodes = (() => { const r = rels?.Relationships?.Relationship; return r ? (Array.isArray(r) ? r : [r]) : []; })() as Record<string, string>[];
		for (const r of nodes) {
			if ((r['@_Type'] || '').includes('/worksheet')) {
				const file = (r['@_Target'] || '').split('/').pop()?.toLowerCase() ?? '';
				const name = rIdToSheetName[r['@_Id']] ?? '';
				if (file && name) wsFileToSheetName[file] = name;
			}
		}
	}

	// 2c. Scan every worksheet _rels file for table references
	for (const zipPath of Object.keys(zip.files)) {
		const m = zipPath.match(/xl[/\\]worksheets[/\\]_rels[/\\](.+\.xml)\.rels$/i);
		if (!m) continue;
		const wsFile = m[1].toLowerCase();
		const sheetName = wsFileToSheetName[wsFile];
		if (!sheetName) continue;
		const relsXml = await zip.file(zipPath)?.async('text');
		if (!relsXml) continue;
		const rels = xmlParser.parse(relsXml);
		const nodes = (() => { const r = rels?.Relationships?.Relationship; return r ? (Array.isArray(r) ? r : [r]) : []; })() as Record<string, string>[];
		for (const r of nodes) {
			if (!(r['@_Type'] || '').includes('/table')) continue;
			const target = r['@_Target'] || '';
			const resolved = ('xl/' + target.replace(/^\.\.\//, '')).toLowerCase();
			tablePathToSheet[resolved] = sheetName;
		}
	}

	// --- Step 3: Parse each table XML ---
	for (const tableZipPath of tableFilePaths) {
		const tableXml = await zip.file(tableZipPath)?.async('text');
		if (!tableXml) continue;

		const tbl = xmlParser.parse(tableXml)?.table as Record<string, unknown> | undefined;
		if (!tbl) continue;

		const name = String(tbl['@_name'] || '');
		const displayName = String(tbl['@_displayName'] || name);
		const ref = String(tbl['@_ref'] || '');
		if (!name || !ref) continue;

		// Resolve sheet: via _rels first, then by cell-content matching
		const sheetName =
			tablePathToSheet[tableZipPath.toLowerCase()] ??
			findSheetForRef(workbook, ref);

		if (!sheetName) continue;

		const columns = columnsFromCells(workbook, sheetName, ref);
		tables.push({ name, displayName, ref, sheetName, zipPath: tableZipPath, columns });
	}

	return tables;
}

function zipTableToInfo(t: ZipTable): ExcelTableInfo {
	const range = xlsx.utils.decode_range(t.ref);
	return {
		name: t.name,
		displayName: t.displayName,
		ref: t.ref,
		sheetName: t.sheetName,
		columns: t.columns,
		dataRowCount: Math.max(0, range.e.r - range.s.r),
	};
}

function findZipTable(tables: ZipTable[], tableName: string): ZipTable {
	const t = tables.find((x) => x.name === tableName || x.displayName === tableName);
	if (!t) throw new Error(`Table "${tableName}" not found. Use "List" to see available tables.`);
	return t;
}

// Public: list all tables in a workbook buffer
export async function getWorkbookTables(buffer: Buffer): Promise<ExcelTableInfo[]> {
	const tables = await extractTablesFromZip(buffer);
	return tables.map(zipTableToInfo);
}

// Return column headers of a named table
export async function getTableColumns(buffer: Buffer, tableName: string): Promise<string[]> {
	const tables = await extractTablesFromZip(buffer);
	return findZipTable(tables, tableName).columns;
}

// Return all data rows of a named table (with optional filters)
export async function getTableRows(
	buffer: Buffer,
	tableName: string,
	filters: Array<{ column: string; value: string }> = [],
): Promise<IDataObject[]> {
	const tables = await extractTablesFromZip(buffer);
	const zt = findZipTable(tables, tableName);
	const workbook = parseWorkbook(buffer);
	const sheet = workbook.Sheets[zt.sheetName];
	if (!sheet) throw new Error(`Sheet "${zt.sheetName}" not found in workbook`);

	const range = xlsx.utils.decode_range(zt.ref);
	const rows: IDataObject[] = [];

	for (let r = range.s.r + 1; r <= range.e.r; r++) {
		const row: IDataObject = {};
		for (let c = range.s.c; c <= range.e.c; c++) {
			const cell = sheet[xlsx.utils.encode_cell({ r, c })];
			row[zt.columns[c - range.s.c]] = cell ? cell.v : '';
		}
		rows.push(row);
	}

	if (filters.length === 0) return rows;
	return rows.filter((row) =>
		filters.every((f) => String(row[f.column] ?? '').toLowerCase() === f.value.toLowerCase()),
	);
}

// ---------------------------------------------------------------------------
// Write helpers — rebuild xlsx preserving table XML from original ZIP
// ---------------------------------------------------------------------------

// Patches the ref attribute in a table XML string
function patchTableRef(tableXml: string, newRef: string): string {
	return tableXml
		.replace(/(<table\b[^>]*\s)ref="[^"]*"/i, `$1ref="${newRef}"`)
		.replace(/(<autoFilter\b[^>]*\s)ref="[^"]*"/i, `$1ref="${newRef}"`);
}

// Writes a modified workbook while preserving all table XML from the original ZIP
async function buildXlsxWithTables(
	originalBuffer: Buffer,
	modifiedWorkbook: xlsx.WorkBook,
	ext: string,
	tableRefUpdates: Record<string, string> = {}, // zipPath → new ref
): Promise<Buffer> {
	// SheetJS serialises cells, but strips table XML — fix that with JSZip
	const newWbBuffer = serializeWorkbook(modifiedWorkbook, ext);

	const [origZip, newZip] = await Promise.all([
		JSZip.loadAsync(originalBuffer),
		JSZip.loadAsync(newWbBuffer),
	]);

	// Copy table XML files (with optional ref patch)
	for (const [path, file] of Object.entries(origZip.files)) {
		if (!path.startsWith('xl/tables/')) continue;
		let content = await file.async('text');
		if (tableRefUpdates[path]) content = patchTableRef(content, tableRefUpdates[path]);
		newZip.file(path, content);
	}

	// Restore worksheet relationship files (which link sheets → tables)
	for (const [path, file] of Object.entries(origZip.files)) {
		if (path.startsWith('xl/worksheets/_rels/')) {
			newZip.file(path, await file.async('text'));
		}
	}

	// Merge Content_Types.xml: add table Override entries that SheetJS omitted
	const origCtXml = (await origZip.file('[Content_Types].xml')?.async('text')) ?? '';
	const newCtXml = (await newZip.file('[Content_Types].xml')?.async('text')) ?? '';
	const tableOverrides = [...origCtXml.matchAll(/<Override[^>]*\/xl\/tables\/[^>]*>/g)].map(
		(m) => m[0],
	);
	if (tableOverrides.length) {
		newZip.file('[Content_Types].xml', newCtXml.replace('</Types>', tableOverrides.join('\n') + '\n</Types>'));
	}

	return Buffer.from(
		await newZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }),
	);
}

// Append a row to a named table → returns new xlsx buffer
export async function appendRowToTable(
	originalBuffer: Buffer,
	tableName: string,
	rowData: IDataObject,
	fileExt: string,
): Promise<Buffer> {
	const tables = await extractTablesFromZip(originalBuffer);
	const zt = findZipTable(tables, tableName);
	const workbook = parseWorkbook(originalBuffer);
	const sheet = workbook.Sheets[zt.sheetName];

	const range = xlsx.utils.decode_range(zt.ref);
	const insertRow = range.e.r + 1;

	zt.columns.forEach((col, colIdx) => {
		const val = rowData[col] ?? '';
		sheet[xlsx.utils.encode_cell({ r: insertRow, c: range.s.c + colIdx })] = {
			v: val,
			t: typeof val === 'number' ? 'n' : typeof val === 'boolean' ? 'b' : 's',
		};
	});

	// Extend sheet ref
	const sheetRange = xlsx.utils.decode_range(sheet['!ref'] ?? 'A1');
	sheetRange.e.r = Math.max(sheetRange.e.r, insertRow);
	sheet['!ref'] = xlsx.utils.encode_range(sheetRange);

	const newTableRef = xlsx.utils.encode_range({ s: range.s, e: { r: insertRow, c: range.e.c } });
	return buildXlsxWithTables(originalBuffer, workbook, fileExt, { [zt.zipPath]: newTableRef });
}

// Update an existing row in a named table → returns new xlsx buffer
export async function updateRowInTable(
	originalBuffer: Buffer,
	tableName: string,
	rowIndex: number,
	rowData: IDataObject,
	fileExt: string,
): Promise<Buffer> {
	const tables = await extractTablesFromZip(originalBuffer);
	const zt = findZipTable(tables, tableName);
	const workbook = parseWorkbook(originalBuffer);
	const sheet = workbook.Sheets[zt.sheetName];

	const range = xlsx.utils.decode_range(zt.ref);
	const dataRowCount = range.e.r - range.s.r;
	if (rowIndex < 1 || rowIndex > dataRowCount) {
		throw new Error(`Row ${rowIndex} out of range — table "${tableName}" has ${dataRowCount} data row(s)`);
	}

	const targetRow = range.s.r + rowIndex;
	zt.columns.forEach((col, colIdx) => {
		if (rowData[col] !== undefined) {
			const val = rowData[col];
			sheet[xlsx.utils.encode_cell({ r: targetRow, c: range.s.c + colIdx })] = {
				v: val,
				t: typeof val === 'number' ? 'n' : typeof val === 'boolean' ? 'b' : 's',
			};
		}
	});

	return buildXlsxWithTables(originalBuffer, workbook, fileExt);
}

// Delete a row from a named table → returns new xlsx buffer
export async function deleteRowFromTable(
	originalBuffer: Buffer,
	tableName: string,
	rowIndex: number,
	fileExt: string,
): Promise<Buffer> {
	const tables = await extractTablesFromZip(originalBuffer);
	const zt = findZipTable(tables, tableName);
	const workbook = parseWorkbook(originalBuffer);
	const sheet = workbook.Sheets[zt.sheetName];

	const range = xlsx.utils.decode_range(zt.ref);
	const dataRowCount = range.e.r - range.s.r;
	if (rowIndex < 1 || rowIndex > dataRowCount) {
		throw new Error(`Row ${rowIndex} out of range — table "${tableName}" has ${dataRowCount} data row(s)`);
	}

	const targetRow = range.s.r + rowIndex;

	// Shift rows up
	for (let r = targetRow; r < range.e.r; r++) {
		for (let c = range.s.c; c <= range.e.c; c++) {
			const src = sheet[xlsx.utils.encode_cell({ r: r + 1, c })];
			const dst = xlsx.utils.encode_cell({ r, c });
			if (src) {
				sheet[dst] = { ...src };
			} else {
				delete sheet[dst];
			}
		}
	}
	for (let c = range.s.c; c <= range.e.c; c++) {
		delete sheet[xlsx.utils.encode_cell({ r: range.e.r, c })];
	}

	const newTableRef = xlsx.utils.encode_range({ s: range.s, e: { r: range.e.r - 1, c: range.e.c } });
	return buildXlsxWithTables(originalBuffer, workbook, fileExt, { [zt.zipPath]: newTableRef });
}

// Load-options helper: returns all named tables in the selected file
export async function getTablesForFile(
	context: ILoadOptionsFunctions,
	filePath: string,
): Promise<INodePropertyOptions[]> {
	const creds = await getCredentials(context);
	const buffer = await downloadFile(context, creds, filePath);
	const tables = await extractTablesFromZip(buffer);
	if (tables.length === 0) {
		return [{ name: '(no named tables found — select the range and use Insert → Table in Excel)', value: '' }];
	}
	return tables.map((t) => {
		const range = xlsx.utils.decode_range(t.ref);
		const dataRows = Math.max(0, range.e.r - range.s.r);
		return {
			name: `${t.displayName}  [${t.sheetName} · ${t.ref} · ${dataRows} rows]`,
			value: t.name,
		};
	});
}
