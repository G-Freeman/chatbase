// types/index.ts — общие типы фронт-фирст
export type User = {
	id: number;
	name: string;
	email?: string;
};

export type Message = {
	id: string;
	from: string;
	text: string;
	ts: string;
};
