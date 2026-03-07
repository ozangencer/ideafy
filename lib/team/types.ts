export interface TeamUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  emailConfirmed: boolean;
}

export interface Team {
  id: string;
  name: string;
  inviteCode: string;
  createdBy: string;
  createdAt: string;
}

export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  displayName: string;
  role: "owner" | "member";
  joinedAt: string;
}

export interface PoolCard {
  id: string;
  teamId: string;
  title: string;
  description?: string;
  solutionSummary?: string;
  testScenarios?: string;
  aiOpinion?: string;
  aiVerdict?: string;
  status: string;
  complexity: string;
  priority: string;
  assignedTo?: string;
  assignedToName?: string;
  pushedBy: string;
  pushedByName?: string;
  pulledBy?: string;
  pulledByName?: string;
  sourceCardId?: string;
  lastSyncedAt: string;
  createdAt: string;
  updatedAt: string;
}
