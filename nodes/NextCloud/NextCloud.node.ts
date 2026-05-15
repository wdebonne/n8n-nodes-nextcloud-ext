import {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	NodeApiError,
	IDataObject,
} from 'n8n-workflow';

import {
	getCredentials,
	davUrl,
	listDirectory,
	downloadFile,
	uploadFile,
	webdavRequest,
} from '../shared/GenericFunctions';

function makeAuthHeader(user: string, password: string): string {
	return 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
}

export class NextCloud implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'NextCloud Folder',
		name: 'nextCloud',
		icon: 'file:nextcloud.svg',
		group: ['input'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Manage files, folders and shares on Nextcloud (WebDAV)',
		defaults: {
			name: 'NextCloud Folder',
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
			// ------------------------------------------------------------------
			// Resource
			// ------------------------------------------------------------------
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'File', value: 'file' },
					{ name: 'Folder', value: 'folder' },
					{ name: 'Share', value: 'share' },
				],
				default: 'file',
			},

			// ==================================================================
			// FILE operations
			// ==================================================================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['file'] } },
				options: [
					{
						name: 'Copy',
						value: 'copy',
						description: 'Copy a file to another path',
						action: 'Copy a file',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a file',
						action: 'Delete a file',
					},
					{
						name: 'Download',
						value: 'download',
						description: 'Download a file',
						action: 'Download a file',
					},
					{
						name: 'List',
						value: 'list',
						description: 'List files inside a folder',
						action: 'List files in a folder',
					},
					{
						name: 'Move',
						value: 'move',
						description: 'Move / rename a file',
						action: 'Move a file',
					},
					{
						name: 'Upload',
						value: 'upload',
						description: 'Upload a file',
						action: 'Upload a file',
					},
				],
				default: 'list',
			},

			// ==================================================================
			// FOLDER operations
			// ==================================================================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['folder'] } },
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Create a folder',
						action: 'Create a folder',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a folder',
						action: 'Delete a folder',
					},
					{
						name: 'List',
						value: 'list',
						description: 'List folder contents',
						action: 'List folder contents',
					},
				],
				default: 'list',
			},

			// ==================================================================
			// SHARE operations
			// ==================================================================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['share'] } },
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Create a public share link',
						action: 'Create a share link',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a share',
						action: 'Delete a share',
					},
					{
						name: 'Get All',
						value: 'getAll',
						description: 'Get all shares',
						action: 'Get all shares',
					},
				],
				default: 'create',
			},

			// ------------------------------------------------------------------
			// FILE: List + Folder: List
			// ------------------------------------------------------------------
			{
				displayName: 'Folder Path',
				name: 'path',
				type: 'string',
				default: '/',
				placeholder: '/Documents',
				description: 'Path of the folder to list (relative to your Nextcloud root)',
				displayOptions: {
					show: {
						operation: ['list'],
					},
				},
			},

			// ------------------------------------------------------------------
			// FILE: Download
			// ------------------------------------------------------------------
			{
				displayName: 'File Path',
				name: 'path',
				type: 'string',
				default: '',
				placeholder: '/Documents/report.xlsx',
				required: true,
				description: 'Path of the file to download',
				displayOptions: {
					show: {
						resource: ['file'],
						operation: ['download'],
					},
				},
			},
			{
				displayName: 'Binary Property Name',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				description: 'Name of the binary property to write the file to',
				displayOptions: {
					show: {
						resource: ['file'],
						operation: ['download'],
					},
				},
			},

			// ------------------------------------------------------------------
			// FILE: Upload
			// ------------------------------------------------------------------
			{
				displayName: 'File Path',
				name: 'path',
				type: 'string',
				default: '',
				placeholder: '/Documents/report.xlsx',
				required: true,
				description: 'Destination path on Nextcloud (including filename)',
				displayOptions: {
					show: {
						resource: ['file'],
						operation: ['upload'],
					},
				},
			},
			{
				displayName: 'Binary Property Name',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				description: 'Name of the binary property that contains the file data',
				displayOptions: {
					show: {
						resource: ['file'],
						operation: ['upload'],
					},
				},
			},

			// ------------------------------------------------------------------
			// FILE: Delete + Folder: Delete
			// ------------------------------------------------------------------
			{
				displayName: 'Path',
				name: 'path',
				type: 'string',
				default: '',
				placeholder: '/Documents/old-file.txt',
				required: true,
				description: 'Path of the file or folder to delete',
				displayOptions: {
					show: {
						operation: ['delete'],
					},
				},
			},

			// ------------------------------------------------------------------
			// FILE: Move / Copy
			// ------------------------------------------------------------------
			{
				displayName: 'Source Path',
				name: 'path',
				type: 'string',
				default: '',
				placeholder: '/Documents/file.txt',
				required: true,
				description: 'Current path of the file',
				displayOptions: {
					show: {
						resource: ['file'],
						operation: ['move', 'copy'],
					},
				},
			},
			{
				displayName: 'Destination Path',
				name: 'destinationPath',
				type: 'string',
				default: '',
				placeholder: '/Archive/file.txt',
				required: true,
				description: 'New path / name for the file',
				displayOptions: {
					show: {
						resource: ['file'],
						operation: ['move', 'copy'],
					},
				},
			},
			{
				displayName: 'Overwrite',
				name: 'overwrite',
				type: 'boolean',
				default: false,
				description: 'Whether to overwrite the destination if it exists',
				displayOptions: {
					show: {
						resource: ['file'],
						operation: ['move', 'copy'],
					},
				},
			},

			// ------------------------------------------------------------------
			// FOLDER: Create
			// ------------------------------------------------------------------
			{
				displayName: 'Folder Path',
				name: 'path',
				type: 'string',
				default: '',
				placeholder: '/Documents/NewFolder',
				required: true,
				description: 'Path of the folder to create',
				displayOptions: {
					show: {
						resource: ['folder'],
						operation: ['create'],
					},
				},
			},

			// ------------------------------------------------------------------
			// SHARE
			// ------------------------------------------------------------------
			{
				displayName: 'Path',
				name: 'path',
				type: 'string',
				default: '',
				placeholder: '/Documents/report.xlsx',
				required: true,
				description: 'Path of the file or folder to share',
				displayOptions: {
					show: {
						resource: ['share'],
						operation: ['create'],
					},
				},
			},
			{
				displayName: 'Share Type',
				name: 'shareType',
				type: 'options',
				options: [
					{ name: 'Public Link', value: 3 },
					{ name: 'User', value: 0 },
					{ name: 'Group', value: 1 },
				],
				default: 3,
				displayOptions: {
					show: {
						resource: ['share'],
						operation: ['create'],
					},
				},
			},
			{
				displayName: 'Share With',
				name: 'shareWith',
				type: 'string',
				default: '',
				description: 'Username or group name to share with (required for User/Group share type)',
				displayOptions: {
					show: {
						resource: ['share'],
						operation: ['create'],
					},
				},
			},
			{
				displayName: 'Permissions',
				name: 'permissions',
				type: 'options',
				options: [
					{ name: 'Read Only (1)', value: 1 },
					{ name: 'Read + Update (3)', value: 3 },
					{ name: 'Read + Create (5)', value: 5 },
					{ name: 'Read + Update + Create (7)', value: 7 },
					{ name: 'All (31)', value: 31 },
				],
				default: 1,
				displayOptions: {
					show: {
						resource: ['share'],
						operation: ['create'],
					},
				},
			},
			{
				displayName: 'Password',
				name: 'sharePassword',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				description: 'Optional password for the share',
				displayOptions: {
					show: {
						resource: ['share'],
						operation: ['create'],
					},
				},
			},
			{
				displayName: 'Expiry Date',
				name: 'expireDate',
				type: 'string',
				default: '',
				placeholder: 'YYYY-MM-DD',
				description: 'Optional expiry date for the share (format: YYYY-MM-DD)',
				displayOptions: {
					show: {
						resource: ['share'],
						operation: ['create'],
					},
				},
			},
			{
				displayName: 'Share ID',
				name: 'shareId',
				type: 'string',
				default: '',
				required: true,
				description: 'ID of the share to delete',
				displayOptions: {
					show: {
						resource: ['share'],
						operation: ['delete'],
					},
				},
			},
		],
	};

	methods = {
		loadOptions: {
			async getFolderFiles(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const creds = await getCredentials(this);
				const entries = await listDirectory(this, creds, '/', '1');
				const options: INodePropertyOptions[] = [{ name: '/ (root)', value: '/' }];
				for (const e of entries) {
					if (e.isDirectory) {
						options.push({ name: e.name, value: `/${e.name}` });
					}
				}
				return options;
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
				// ----------------------------------------------------------------
				// FILE operations
				// ----------------------------------------------------------------
				if (resource === 'file' || resource === 'folder') {
					if (operation === 'list') {
						const path = this.getNodeParameter('path', i, '/') as string;
						const entries = await listDirectory(this, creds, path, '1');
						for (const entry of entries) {
							const rel = entry.href.replace(
								`/remote.php/dav/files/${encodeURIComponent(creds.user)}/`,
								'/',
							);
							if (rel === path || rel === path + '/') continue; // skip the folder itself
							returnData.push({
								json: {
									name: entry.name,
									path: rel,
									isDirectory: entry.isDirectory,
									size: entry.size,
									contentType: entry.contentType,
									lastModified: entry.lastModified,
									fileId: entry.fileId,
								},
							});
						}
					} else if (operation === 'download') {
						const path = this.getNodeParameter('path', i) as string;
						const binaryProp = this.getNodeParameter('binaryPropertyName', i, 'data') as string;
						const buffer = await downloadFile(this, creds, path);
						const fileName = path.split('/').pop() ?? 'file';
						const binaryData = await this.helpers.prepareBinaryData(buffer, fileName);
						returnData.push({ json: { path, fileName }, binary: { [binaryProp]: binaryData } });
					} else if (operation === 'upload') {
						const path = this.getNodeParameter('path', i) as string;
						const binaryProp = this.getNodeParameter('binaryPropertyName', i, 'data') as string;
						const binaryData = this.helpers.assertBinaryData(i, binaryProp);
						const buffer = await this.helpers.getBinaryDataBuffer(i, binaryProp);
						await uploadFile(this, creds, path, buffer, binaryData.mimeType);
						returnData.push({ json: { success: true, path, size: buffer.length } });
					} else if (operation === 'delete') {
						const path = this.getNodeParameter('path', i) as string;
						const url = davUrl(creds.serverUrl, creds.user, path);
						const res = await webdavRequest(this, 'DELETE', url, creds);
						if (res.statusCode >= 400) {
							throw new NodeApiError(this.getNode(), { message: `Delete failed: ${res.statusCode}` });
						}
						returnData.push({ json: { success: true, path } });
					} else if (operation === 'move' || operation === 'copy') {
						const path = this.getNodeParameter('path', i) as string;
						const dest = this.getNodeParameter('destinationPath', i) as string;
						const overwrite = this.getNodeParameter('overwrite', i, false) as boolean;
						const method = operation === 'move' ? 'MOVE' : 'COPY';
						const sourceUrl = davUrl(creds.serverUrl, creds.user, path);
						const destUrl = davUrl(creds.serverUrl, creds.user, dest);
						const res = await webdavRequest(this, method, sourceUrl, creds, {
							Destination: destUrl,
							Overwrite: overwrite ? 'T' : 'F',
						});
						if (res.statusCode >= 400) {
							throw new NodeApiError(this.getNode(), {
								message: `${method} failed: ${res.statusCode}`,
							});
						}
						returnData.push({ json: { success: true, from: path, to: dest } });
					} else if (operation === 'create' && resource === 'folder') {
						const path = this.getNodeParameter('path', i) as string;
						const url = davUrl(creds.serverUrl, creds.user, path);
						const res = await webdavRequest(this, 'MKCOL', url, creds);
						if (res.statusCode >= 400 && res.statusCode !== 405) {
							throw new NodeApiError(this.getNode(), {
								message: `Create folder failed: ${res.statusCode}`,
							});
						}
						returnData.push({ json: { success: true, path } });
					}
				}

				// ----------------------------------------------------------------
				// SHARE operations (OCS Share API)
				// ----------------------------------------------------------------
				if (resource === 'share') {
					const baseOcs = `${creds.serverUrl}/ocs/v2.php/apps/files_sharing/api/v1/shares`;
					const ocsHeaders = {
						Authorization: makeAuthHeader(creds.user, creds.password),
						'OCS-APIREQUEST': 'true',
						Accept: 'application/json',
					};

					if (operation === 'create') {
						const path = this.getNodeParameter('path', i) as string;
						const shareType = this.getNodeParameter('shareType', i, 3) as number;
						const shareWith = this.getNodeParameter('shareWith', i, '') as string;
						const permissions = this.getNodeParameter('permissions', i, 1) as number;
						const sharePassword = this.getNodeParameter('sharePassword', i, '') as string;
						const expireDate = this.getNodeParameter('expireDate', i, '') as string;

						const body: IDataObject = { path, shareType, permissions };
						if (shareWith) body.shareWith = shareWith;
						if (sharePassword) body.password = sharePassword;
						if (expireDate) body.expireDate = expireDate;

						const res = await this.helpers.httpRequest({
							method: 'POST',
							url: baseOcs,
							headers: { ...ocsHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
							body: new URLSearchParams(
								Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v)])),
							).toString(),
							returnFullResponse: true,
							ignoreHttpStatusErrors: true,
						});
						const data = (res.body as IDataObject)?.ocs as IDataObject;
						returnData.push({ json: data ?? (res.body as IDataObject) });
					} else if (operation === 'delete') {
						const shareId = this.getNodeParameter('shareId', i) as string;
						await this.helpers.httpRequest({
							method: 'DELETE',
							url: `${baseOcs}/${shareId}`,
							headers: ocsHeaders,
						});
						returnData.push({ json: { success: true, shareId } });
					} else if (operation === 'getAll') {
						const res = await this.helpers.httpRequest({
							method: 'GET',
							url: baseOcs,
							headers: ocsHeaders,
						});
						const shares = (res as IDataObject)?.ocs as IDataObject;
						const list = (shares?.data as IDataObject[]) ?? [];
						for (const s of list) {
							returnData.push({ json: s });
						}
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
