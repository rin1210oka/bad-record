import {normalizeMemberName} from './member-name';
export type MatchPeople={ownIds:string[];oppositeIds:string[];opponents:string[]};
export function matchPeople(match:{sideAIds:string[];sideBIds:string[];opponentType:string;opponents:string[]},memberId:string):MatchPeople|null{
  const sideA=match.sideAIds.includes(memberId);
  if(!sideA&&!(match.opponentType==='internal'&&match.sideBIds.includes(memberId)))return null;
  return {ownIds:sideA?match.sideAIds:match.sideBIds,oppositeIds:match.opponentType==='internal'?(sideA?match.sideBIds:match.sideAIds):[],opponents:match.opponentType==='external'?match.opponents:[]};
}
export const opponentNameKey=(name:string)=>normalizeMemberName(name).toLocaleLowerCase('ja-JP');
export function matchesPeople(people:MatchPeople|null|undefined,partnerId:string,opponent:string){
  if(!partnerId&&!opponent)return true;
  if(!people)return false;
  if(partnerId&&!people.ownIds.includes(partnerId))return false;
  if(opponent.startsWith('id:'))return people.oppositeIds.includes(opponent.slice(3));
  if(opponent.startsWith('name:'))return people.opponents.some(name=>opponentNameKey(name)===opponent.slice(5));
  return !opponent;
}
export function inDateRange(date:string,from:string,to:string){return (!from||date>=from)&&(!to||date<=to);}
