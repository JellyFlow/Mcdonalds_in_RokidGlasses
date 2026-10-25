import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Session } from '../types/index.js';
export class Store {
 db:DatabaseSync;
 constructor(path:string){
  if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
  this.db=new DatabaseSync(path);
  this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS submissions(action_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, order_id TEXT, started_at INTEGER NOT NULL);');
  // A process may have stopped after sending a write. Never blindly resend it.
  this.db.exec("UPDATE submissions SET status='uncertain' WHERE status='submitting'");
 }
 latest(){const r=this.db.prepare('SELECT body FROM sessions ORDER BY rowid DESC LIMIT 1').get();return r?JSON.parse(r.body as string) as Session:undefined;}
 pending(){return this.db.prepare("SELECT session_id FROM submissions WHERE status IN ('submitting','uncertain') ORDER BY started_at DESC LIMIT 1").get();}
 get(id:string):Session|undefined{const r=this.db.prepare('SELECT body FROM sessions WHERE id=?').get(id);return r?JSON.parse(r.body as string):undefined;}
 save(s:Session){this.db.prepare('INSERT INTO sessions VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(s.id,JSON.stringify(s));}
 submission(id:string){return this.db.prepare('SELECT * FROM submissions WHERE action_id=?').get(id);}
 begin(actionId:string,s:Session,kind:string){this.db.prepare('INSERT INTO submissions VALUES(?,?,?,\'submitting\',NULL,?)').run(actionId,s.id,kind,Date.now());}
 finish(actionId:string,status:string,orderId?:string){this.db.prepare('UPDATE submissions SET status=?,order_id=? WHERE action_id=?').run(status,orderId??null,actionId);}
 finishSession(actionId:string,s:Session,orderId?:string){
  this.db.exec('BEGIN IMMEDIATE');
  try{this.finish(actionId,'complete',orderId);this.save(s);this.db.exec('COMMIT');}
  catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 unresolved(sid:string){return this.db.prepare("SELECT * FROM submissions WHERE session_id=? AND status IN ('submitting','uncertain') ORDER BY started_at DESC LIMIT 1").get(sid);}
 close(){this.db.close();}
}
