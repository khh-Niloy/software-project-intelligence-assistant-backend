export interface RequirementPayload {
  id: string;
  title: string;
  description: string;
  status?: string;
}

export class ApproveTraceDto {
  projectName?: string;
  repoName: string;
  repoOwner?: string;
  documentId?: string;
  documentName?: string;
  requirements: RequirementPayload[];
}
