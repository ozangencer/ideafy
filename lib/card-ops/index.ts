// Card operations shared by the app and the MCP server.
//
// A write that both the app's routes and the MCP tools perform lives here
// once, against the small SqlDb surface both drivers satisfy, so a terminal
// session and the app cannot drift apart on what a move or a save does. Write
// paths move in here as cards touch them; a new MCP tool or route does not
// write cards with its own SQL.
export {
  transaction,
  runChanges,
  getRow,
  allRows,
  type SqlDb,
  type Statement,
} from "./db";
export { moveCard, completedAtFor, isStatus, type MoveCardResult } from "./move-card";
