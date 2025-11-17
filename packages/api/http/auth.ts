// auth.ts
import { api } from './index';

export const auth = (key:number, locale:string, partner:string, tz:number) => {
	return api.post(`/auth/`, {key, locale, partner, tz});
}
