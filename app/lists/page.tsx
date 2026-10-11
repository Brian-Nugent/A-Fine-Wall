"use client";

import { useState } from "react";
import { useActiveUser } from "../user-profile-provider";
import { MAX_LIST_NAME_LENGTH } from "./climb-lists";
import { useClimbLists } from "./use-climb-lists";

export default function ListsPage() {
  const { profile, changeUser } = useActiveUser();
  const lists = useClimbLists(profile?.id);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  return (
    <main className="app-page lists-page">
      <header className="detail-header"><a className="back-link" href="/climbs">&larr; Climbs</a></header>
      <section className="lists-content" aria-labelledby="my-lists-heading">
      <h1 id="my-lists-heading">My Lists</h1>
      <button className="user-switch-button" onClick={changeUser} type="button">Using {profile?.name ?? "no user"}</button>
      <p className="lists-intro">Keep your projects, warm-ups, and favorite climbs together.</p>
      <form className="climb-form list-name-form" onSubmit={async event => {
        event.preventDefault();
        if (await lists.create(name)) setName("");
      }}>
        <label htmlFor="new-list-name">New list name</label>
        <div className="list-inline-form">
          <input id="new-list-name" required maxLength={MAX_LIST_NAME_LENGTH} placeholder="e.g. Projects" value={name} onChange={event => setName(event.target.value)} />
          <button className="primary-button" disabled={lists.busy || !lists.ready || !name.trim()} type="submit">Create List</button>
        </div>
      </form>
      {lists.error ? <div className="form-error" role="alert">{lists.error} <button className="text-button" onClick={lists.reload} type="button">Retry</button></div> : null}
      {!lists.ready && !lists.error ? <p role="status">Loading your lists&hellip;</p> : null}
      {lists.ready && !lists.lists.length ? <p className="lists-empty">No lists yet. Create one, then open a climb and choose “Save to list”.</p> : null}
      <ul className="personal-lists">
        {lists.lists.map(list => (
          <li key={list.id}>
            {editing === list.id ? (
              <form className="climb-form list-name-form" onSubmit={async event => {
                event.preventDefault();
                if (await lists.rename(list.id, editName)) setEditing(null);
              }}>
                <label htmlFor={`rename-${list.id}`}>List name</label>
                <input id={`rename-${list.id}`} required maxLength={MAX_LIST_NAME_LENGTH} value={editName} onChange={event => setEditName(event.target.value)} />
                <div className="list-actions"><button className="secondary-button" disabled={lists.busy || !editName.trim()} type="submit">Save Name</button><button className="text-button" onClick={() => setEditing(null)} type="button">Cancel</button></div>
              </form>
            ) : (
              <>
                <a className="personal-list-link" href={`/climbs?list=${encodeURIComponent(list.id)}`}><strong>{list.name}</strong><span>{list.climbIds.length} {list.climbIds.length === 1 ? "climb" : "climbs"} &rarr;</span></a>
                <div className="list-actions">
                  <button aria-label={`Rename ${list.name}`} className="text-button" onClick={() => { setEditing(list.id); setEditName(list.name); setDeleting(null); }} type="button">Rename</button>
                  <button aria-label={`Delete ${list.name}`} className="text-button" onClick={() => setDeleting(list.id)} type="button">Delete</button>
                </div>
              </>
            )}
            {deleting === list.id ? <div className="list-delete-confirm"><p>Delete “{list.name}”? The climbs will stay on the wall.</p><div className="list-actions"><button className="secondary-button" disabled={lists.busy} onClick={async () => { if (await lists.remove(list.id)) setDeleting(null); }} type="button">Delete List</button><button className="text-button" onClick={() => setDeleting(null)} type="button">Cancel</button></div></div> : null}
          </li>
        ))}
      </ul>
      </section>
    </main>
  );
}
