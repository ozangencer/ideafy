import { NextRequest } from "next/server";
import { getAllProcesses, killProcess } from "@/lib/process-registry";

// GET: List all active processes
export async function GET() {
  const processes = getAllProcesses();
  return Response.json(processes);
}

// DELETE: Kill a specific process by processKey
export async function DELETE(request: NextRequest) {
  const processKey = request.nextUrl.searchParams.get("processKey");

  if (!processKey) {
    return Response.json(
      { success: false, error: "Missing processKey parameter" },
      { status: 400 }
    );
  }

  const killed = killProcess(processKey);

  if (killed) {
    return Response.json({ success: true, message: "Process killed" });
  }

  return Response.json(
    { success: false, error: "Process not found" },
    { status: 404 }
  );
}
