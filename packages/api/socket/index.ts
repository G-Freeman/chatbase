// SOCKET
import { WebSocket } from 'ws';
import { EventEmitter } from 'events';

export interface WSOptions {
	headers?: Record<string, string>;
	reconnect?: boolean;
}

type WSMessage = { action: string; data: any; marker?: string };
type TestType = { param: string, param2: number };

export class WSClient extends EventEmitter {
	private ws?: WebSocket;
	private url: string;
	private options: WSOptions;

	constructor(url: string, options: WSOptions = {}) {
		super();
		this.url = url;
		this.options = options;
	}

	connect() {
		this.ws = new WebSocket(this.url, {headers: this.options.headers});

		this.ws.on('open', () => this.emit('open'));
		this.ws.on('message', (msg) => this.emit('message', msg.toString()));
		this.ws.on('close', (code, reason) => {
			this.emit('close', code, reason.toString());
			if (this.options.reconnect) setTimeout(() => this.connect(), 1000);
		});
		this.ws.on('error', (err) => this.emit('error', err));
	}

	send(data: any) {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN)
			throw new Error('WebSocket is not open');
		this.ws.send(JSON.stringify(data));
	}

	close() {
		this.ws?.close();
	}D
}


export const ws = new WSClient('wss://api.example.com/ws', { headers: { Authorization: 'Bearer TOKEN' }, reconnect: true });

ws.on('open', () => console.log('connected'));
export const onMessage = (event: string) => {
	let msg: WSMessage
	try { msg = JSON.parse(event); }
	catch { return console.error('Bad JSON'); }

	if (typeof msg.action !== 'string') return;
	const data = msg.data;

	switch ( msg.action ) {
		case 'connect': {
			console.log((data as TestType).param)
		} break;
		case 'ping': break;
		case 'pong': break;
	}
}
ws.on('message', onMessage);

ws.connect();