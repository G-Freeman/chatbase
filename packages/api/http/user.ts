// user.ts
import { api } from './index';
import {User} from "../../types";

export const getUser = (id:number) => {
	return api.get(`/user/${id}`);
}

export const setUser = (user:User) => {
	return api.post(`/user/${user.id}`, user);
}
