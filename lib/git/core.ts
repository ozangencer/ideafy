import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Every git invocation in this module goes through `git()` which uses
// execFile. That means args are passed as a real argv array — no shell,
// no string interpolation, no escaping contract the caller has to honour.
// A branch name containing $(id), "; rm -rf ~; echo ", or a newline is a
// literal argument that git will either accept or reject, never shell out.
export async function git(
  cwd: string,
  ...args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, { cwd });
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 50);
}

export function generateBranchName(
  idPrefix: string,
  taskNumber: number,
  title: string
): string {
  const slug = slugify(title);
  return `kanban/${idPrefix}-${taskNumber}-${slug}`;
}

// Build `git commit` argv with title + optional body separated at the first
// blank line, as distinct -m values. Passing them through argv means no shell
// quoting is required — a message containing $(id), backticks, or newlines
// lands in git as literal text.
export function buildCommitArgs(commitMessage: string): string[] {
  const [title, ...bodyParts] = commitMessage.split("\n\n");
  const body = bodyParts.join("\n\n");
  const args = ["commit", "-m", title];
  if (body) args.push("-m", body);
  return args;
}
