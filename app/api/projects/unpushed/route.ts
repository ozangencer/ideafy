import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { getUnpushedStatus } from "@/lib/git";

/**
 * Unpushed commit counts for every project, for the sidebar badge.
 *
 * Deliberately does not fetch: this runs on every sidebar load, and a network
 * round trip per project would make opening the app wait on GitHub. The number
 * therefore reflects the last known state of the remote, which is enough to
 * say "something here has not left this machine". The detail view fetches.
 */
export async function GET() {
  try {
    const projects = db.select().from(schema.projects).all();

    const results = await Promise.all(
      projects.map(async (project) => {
        const status = await getUnpushedStatus(project.folderPath);
        return {
          projectId: project.id,
          supported: status.supported,
          defaultBranch: status.defaultBranch,
          count: status.count,
        };
      })
    );

    return NextResponse.json(results);
  } catch (error) {
    console.error("Failed to read unpushed counts:", error);
    return NextResponse.json(
      { error: "Failed to read unpushed counts" },
      { status: 500 }
    );
  }
}
