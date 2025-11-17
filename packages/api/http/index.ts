// HTTP
import fetch from 'node-fetch';

export interface HttpRequestOptions {
	method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
	headers?: Record<string, string>;
	body?: any;
}

export class HttpClient {
	constructor(private baseUrl: string, private defaultHeaders: Record<string, string> = {}) {}

	async request<T>(path: string, options: HttpRequestOptions = {}): Promise<T> {
		const { method = 'GET', headers = {}, body } = options;
		const res = await fetch(`${this.baseUrl}${path}`, {
			method,
			headers: { ...this.defaultHeaders, ...headers },
			body: body ? JSON.stringify(body) : undefined,
		});

		if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
		return (await res.json()) as T;
	}

	get<T>(path: string, headers?: Record<string, string>) {
		return this.request<T>(path, { method: 'GET', headers });
	}

	post<T>(path: string, body?: any, headers?: Record<string, string>) {
		return this.request<T>(path, { method: 'POST', headers, body });
	}

	put<T>(path: string, body?: any, headers?: Record<string, string>) {
		return this.request<T>(path, { method: 'PUT', headers, body });
	}

	delete<T>(path: string, headers?: Record<string, string>) {
		return this.request<T>(path, { method: 'DELETE', headers });
	}
}

export const api = new HttpClient('https://api.example.com', { Authorization: 'Bearer TOKEN' });
