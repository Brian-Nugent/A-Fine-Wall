import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable(
  "profiles",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_profiles_name_nocase").on(
      sql`${table.name} COLLATE NOCASE`,
    ),
  ],
);

export const wallConfiguration = sqliteTable("wall_configuration", {
  id: integer("id").primaryKey(),
  holdsJson: text("holds_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const climbs = sqliteTable(
  "climbs",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    grade: text("grade").notNull(),
    setter: text("setter").notNull(),
    createdAt: integer("created_at").notNull(),
    holdsJson: text("holds_json").notNull(),
    isCircuit: integer("is_circuit", { mode: "boolean" }).notNull().default(false),
    rockoApproved: integer("rocko_approved", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [index("idx_climbs_created_at").on(table.createdAt)],
);

export const deletedClimbs = sqliteTable("deleted_climbs", {
  id: text("id").primaryKey(),
  deletedAt: integer("deleted_at").notNull(),
});

export const climbLists = sqliteTable("climb_lists", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("idx_climb_lists_profile_id").on(table.profileId)]);

export const climbListEntries = sqliteTable("climb_list_entries", {
  listId: text("list_id").notNull().references(() => climbLists.id, { onDelete: "cascade" }),
  climbId: text("climb_id").notNull().references(() => climbs.id, { onDelete: "cascade" }),
  addedAt: integer("added_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.listId, table.climbId] }),
  index("idx_climb_list_entries_climb_id").on(table.climbId),
]);

export const climbSends = sqliteTable(
  "climb_sends",
  {
    climbKind: text("climb_kind", { enum: ["demo", "saved"] }).notNull(),
    climbId: text("climb_id").notNull(),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    grade: text("grade"),
    rating: integer("rating").notNull(),
    sentAt: integer("sent_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.climbKind, table.climbId, table.profileId],
      name: "climb_sends_climb_profile_pk",
    }),
    check(
      "climb_sends_kind_check",
      sql`${table.climbKind} IN ('demo', 'saved')`,
    ),
    check(
      "climb_sends_rating_check",
      sql`${table.rating} IN (1, 2, 3, 4, 5)`,
    ),
    index("idx_climb_sends_profile_id").on(table.profileId),
  ],
);
