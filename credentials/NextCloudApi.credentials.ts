import {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class NextCloudApi implements ICredentialType {
	name = 'nextCloudApi';
	displayName = 'Nextcloud API';
	documentationUrl = 'https://docs.nextcloud.com/server/latest/developer_manual/client_apis/WebDAV/basic.html';
	properties: INodeProperties[] = [
		{
			displayName: 'Server URL',
			name: 'serverUrl',
			type: 'string',
			default: '',
			placeholder: 'https://nextcloud.example.com',
			description: 'The base URL of your Nextcloud instance (no trailing slash)',
			required: true,
		},
		{
			displayName: 'Username',
			name: 'user',
			type: 'string',
			default: '',
			required: true,
		},
		{
			displayName: 'Password / App Password',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'Your Nextcloud password or an app password generated in Settings → Security',
			required: true,
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			auth: {
				username: '={{$credentials.user}}',
				password: '={{$credentials.password}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.serverUrl}}',
			url: '/ocs/v1.php/cloud/capabilities?format=json',
			headers: {
				'OCS-APIREQUEST': 'true',
			},
		},
	};
}
