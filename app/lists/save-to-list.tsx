"use client";

import { useEffect, useRef, useState } from "react";
import { useActiveUser } from "../user-profile-provider";
import { MAX_LIST_NAME_LENGTH } from "./climb-lists";
import { useClimbLists } from "./use-climb-lists";

export default function SaveToList({ climbId, onBack }: { climbId: string; onBack(): void }) {
  const { profile } = useActiveUser();
  const [name, setName] = useState("");
  const lists = useClimbLists(profile?.id);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { backButtonRef.current?.focus(); }, []);
  return (
    <div className="save-list-panel">
      <button className="text-button save-list-back" onClick={onBack} ref={backButtonRef} type="button">&larr; Back to options</button>
      <h2>Save to your lists</h2>
      {!lists.ready && !lists.error ? <p role="status">Loading your lists&hellip;</p> : null}
      {lists.error ? <div className="form-error" role="alert">{lists.error} <button className="text-button" onClick={lists.reload} type="button">Retry</button></div> : null}
      {lists.lists.map(list => <label className="list-membership" key={list.id}>
        <input type="checkbox" checked={list.climbIds.includes(climbId)} disabled={lists.busy} onChange={event => void lists.setMembership(list.id, climbId, event.target.checked)} />
        <span>{list.name}</span>
      </label>)}
      <form className="climb-form list-name-form" onSubmit={async event => {
        event.preventDefault();
        const result = await lists.create(name);
        if (result?.list) {
          setName("");
          await lists.setMembership(result.list.id, climbId, true);
        }
      }}>
        <label htmlFor="save-new-list">New list name</label>
        <div className="list-inline-form"><input id="save-new-list" required maxLength={MAX_LIST_NAME_LENGTH} placeholder="e.g. Warm-ups" value={name} onChange={event => setName(event.target.value)} /><button className="secondary-button" disabled={!lists.ready || lists.busy || !name.trim()} type="submit">Create &amp; Save</button></div>
      </form>
      <a className="manage-lists-link" href="/lists">Manage my lists &rarr;</a>
    </div>
  );
}
