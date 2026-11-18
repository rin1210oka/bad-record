import PlayerSearch from './player-search';
import type {CohortFields} from '../lib/member-cohort';
import {opponentNameKey,type MatchPeople} from '../lib/match-search';
export type SearchPlayer={id:string;name:string;group:string;status:'active'|'inactive';deletedAt?:string|null}&CohortFields;
export default function MatchPeopleFilters({people,members,memberId,partnerId,opponent,onPartner,onOpponent}:{people:(MatchPeople|null|undefined)[];members:SearchPlayer[];memberId:string;partnerId:string;opponent:string;onPartner:(id:string)=>void;onOpponent:(value:string)=>void}){
  const ownIds=new Set(people.flatMap(item=>item?.ownIds||[]));ownIds.delete(memberId);
  const oppositeIds=new Set(people.flatMap(item=>item?.oppositeIds||[]));
  const partnerCandidates=members.filter(member=>ownIds.has(member.id));
  const opponents=members.filter(member=>oppositeIds.has(member.id)).map(member=>({...member,id:'id:'+member.id}));
  const names=new Map<string,string>();for(const item of people)for(const name of item?.opponents||[])names.set(opponentNameKey(name),name);
  for(const [key,name] of names)opponents.push({id:'name:'+key,name,group:'名前で記録された対戦相手',status:'active',affiliation:'unspecified',stageMode:'unspecified',internalHistory:false});
  return <div className="match-people-filters"><PlayerSearch showSelection label="ペア相手で絞り込み" members={partnerCandidates} value={partnerId} onChange={onPartner}/><PlayerSearch showSelection label="対戦相手で絞り込み" members={opponents} value={opponent} onChange={onOpponent}/></div>;
}
