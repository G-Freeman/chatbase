import {User} from "../../types";
import {ws} from "./index";

export const testUser = (id:number) => {
	return ws.send({ action:'testUser',
		user:{ id, name: 'testUser' } as User
	});
}