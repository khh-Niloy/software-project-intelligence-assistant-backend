import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { cosineSimilarity } from '@langchain/core/utils/math';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { Project, ProjectRecord } from './schemas/project.schema';
import {
  Requirement,
  RequirementRecord,
  EvidenceItem,
} from './schemas/requirement.schema';
import { Document, DocumentRecord } from '../document/schemas/document.schema';
import {
  DocumentChunk,
  DocumentChunkRecord,
} from '../document/schemas/document-chunk.schema';
import {
  GithubCodeChunk,
  GithubCodeChunkRecord,
} from '../github/schemas/github-code-chunk.schema';
import { IngestionService } from '../ingestion/ingestion.service';
import { DocumentService } from '../document/document.service';
import { ApproveTraceDto } from './dto/approve-trace.dto';

export interface ExtractedRequirement {
  id: string;
  title: string;
  description: string;
  status: string;
}

@Injectable()
export class TraceService {
  private readonly logger = new Logger(TraceService.name);

  constructor(
    @InjectModel(Project.name)
    private readonly projectModel: Model<ProjectRecord>,
    @InjectModel(Requirement.name)
    private readonly requirementModel: Model<RequirementRecord>,
    @InjectModel(Document.name)
    private readonly documentModel: Model<DocumentRecord>,
    @InjectModel(DocumentChunk.name)
    private readonly documentChunkModel: Model<DocumentChunkRecord>,
    @InjectModel(GithubCodeChunk.name)
    private readonly githubCodeChunkModel: Model<GithubCodeChunkRecord>,
    private readonly ingestionService: IngestionService,
    private readonly documentService: DocumentService,
  ) {}

  /**
   * Extract features and requirements from an uploaded file or an existing document.
   */
  async extractRequirements(
    file?: Express.Multer.File,
    documentId?: string,
  ): Promise<{
    documentName: string;
    documentId?: string;
    totalRequirements: number;
    requirements: ExtractedRequirement[];
  }> {
    let documentName = 'Uploaded Requirement Document';
    let docId: string | undefined = undefined;
    let fullText = '';

    if (file) {
      documentName = file.originalname;
      this.logger.log(`Parsing uploaded requirement file: ${documentName}`);
      try {
        const langchainDocs =
          await this.ingestionService.loadDocumentWithLangchain(
            file.buffer,
            file.originalname,
          );
        fullText = langchainDocs.map((doc) => doc.pageContent).join('\n\n');
      } catch (err) {
        this.logger.warn(
          `LangChain loader failed for ${documentName}, attempting raw text parse: ${err}`,
        );
        fullText = file.buffer.toString('utf-8');
      }
    } else if (documentId) {
      docId = documentId;
      if (!Types.ObjectId.isValid(documentId)) {
        throw new BadRequestException(`Invalid document ID: ${documentId}`);
      }

      const doc = await this.documentModel.findById(documentId).exec();
      if (!doc) {
        throw new NotFoundException(`Document with ID "${documentId}" not found`);
      }
      documentName = doc.filename;

      if (doc.originalText && doc.originalText.trim().length > 0) {
        fullText = doc.originalText;
      } else {
        const chunks = await this.documentChunkModel
          .find({ documentId })
          .sort({ chunkIndex: 1 })
          .select('text')
          .exec();

        if (chunks && chunks.length > 0) {
          fullText = chunks.map((c) => c.text).join('\n\n');
        }
      }
    } else {
      throw new BadRequestException(
        'Either a file or a valid documentId must be provided for requirement extraction.',
      );
    }

    if (!fullText || !fullText.trim()) {
      throw new BadRequestException(
        `No readable text could be found in document: "${documentName}". Please provide a valid requirement document.`,
      );
    }

    this.logger.log(
      `Extracted ${fullText.length} characters of raw text from "${documentName}". Generating requirements with LLM...`,
    );

    const requirements = await this.callLlmToExtractRequirements(
      fullText,
      documentName,
    );

    return {
      documentName,
      documentId: docId,
      totalRequirements: requirements.length,
      requirements,
    };
  }

  /**
   * Final approval:
   * 1. Create or upsert Project document using repoName.
   * 2. Analyze requirements against githubCodeChunk records for repoName.
   * 3. Create individual Requirement records with evidence and implementationStatus.
   */
  async approveRequirements(dto: ApproveTraceDto) {
    if (!dto.repoName || !dto.repoName.trim()) {
      throw new BadRequestException('A target repository name must be selected.');
    }

    const repoName = dto.repoName.trim();

    if (!dto.requirements || dto.requirements.length === 0) {
      throw new BadRequestException('At least one requirement must be approved.');
    }

    // Check if project for this repository has already been added
    const existingProject = await this.projectModel.findOne({ repoName }).exec();
    if (existingProject) {
      throw new BadRequestException(
        `A traceability project for repository "${repoName}" has already been approved and added.`,
      );
    }

    // Verify repository has been ingested and has code chunks
    const codeChunksCount = await this.githubCodeChunkModel
      .countDocuments({ repoName })
      .exec();
    if (codeChunksCount === 0) {
      throw new BadRequestException(
        `Repository "${repoName}" has not been ingested yet. Please ingest the repository first so code chunks are available for traceability analysis.`,
      );
    }

    this.logger.log(
      `Starting final approval for repo: "${repoName}". Creating Project document...`,
    );

    // Step 1: Create Project document
    const project = await this.projectModel.create({ repoName });

    this.logger.log(`Project document ready (ID: ${project._id}).`);

    // Step 2: Fetch code chunks for this repository to perform traceability analysis
    const codeChunks = await this.githubCodeChunkModel
      .find({ repoName })
      .lean()
      .exec();

    this.logger.log(
      `Loaded ${codeChunks.length} code chunks for repository "${repoName}".`,
    );

    // Remove existing requirements for this repository before inserting refreshed analysis
    await this.requirementModel.deleteMany({ 'repository.name': repoName });

    // Step 3: Analyze each requirement and create requirement documents
    const createdRequirements: RequirementRecord[] = [];

    for (let index = 0; index < dto.requirements.length; index++) {
      const req = dto.requirements[index];
      const slug = req.id || `REQ-${String(index + 1).padStart(3, '0')}`;

      this.logger.log(
        `[${index + 1}/${dto.requirements.length}] Evaluating "${slug}: ${req.title}"...`,
      );

      const { implementationStatus, evidence } =
        await this.evaluateRequirementImplementation(
          req.title,
          req.description,
          repoName,
          codeChunks,
        );

      const requirementDoc = new this.requirementModel({
        requirementSlug: slug,
        title: req.title,
        description: req.description,
        source: {
          documentId:
            dto.documentId && Types.ObjectId.isValid(dto.documentId)
              ? new Types.ObjectId(dto.documentId)
              : undefined,
          documentName: dto.documentName || '',
          pageNumber: 1,
        },
        evidence,
        implementationStatus,
        repository: {
          owner: dto.repoOwner || '',
          name: repoName,
          branch: 'main',
          commitSha: '',
        },
      });

      const saved = await requirementDoc.save();
      createdRequirements.push(saved);
    }

    const summary = {
      total: createdRequirements.length,
      completed: createdRequirements.filter(
        (r) => r.implementationStatus === 'completed',
      ).length,
      partially_implemented: createdRequirements.filter(
        (r) => r.implementationStatus === 'partially_implemented',
      ).length,
      not_implemented: createdRequirements.filter(
        (r) => r.implementationStatus === 'not_implemented',
      ).length,
    };

    this.logger.log(
      `Approval & analysis complete for repo "${repoName}": ${summary.completed} completed, ${summary.partially_implemented} partial, ${summary.not_implemented} not implemented.`,
    );

    return {
      message: 'Requirements approved and traceability analysis completed.',
      project,
      summary,
      requirements: createdRequirements,
    };
  }

  /**
   * Get all projects with summary stats for the trace page
   */
  async getAllProjects() {
    const projects = await this.projectModel
      .find()
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    return Promise.all(
      projects.map(async (project) => {
        const reqs = await this.requirementModel
          .find({ 'repository.name': project.repoName })
          .select('implementationStatus')
          .lean()
          .exec();

        return {
          ...project,
          totalRequirements: reqs.length,
          completedCount: reqs.filter(
            (r) => r.implementationStatus === 'completed',
          ).length,
          partiallyCount: reqs.filter(
            (r) => r.implementationStatus === 'partially_implemented',
          ).length,
          notImplementedCount: reqs.filter(
            (r) => r.implementationStatus === 'not_implemented',
          ).length,
        };
      }),
    );
  }

  /**
   * Get all requirement documents by repoName
   */
  async getRequirementsByRepoName(repoName: string) {
    if (!repoName?.trim()) {
      throw new BadRequestException('A repoName is required.');
    }

    return this.requirementModel
      .find({ 'repository.name': repoName.trim() })
      .sort({ requirementSlug: 1 })
      .exec();
  }

  /**
   * Evaluates code chunks against a single requirement to determine implementationStatus & evidence.
   */
  private async evaluateRequirementImplementation(
    title: string,
    description: string,
    repoName: string,
    chunks: GithubCodeChunkRecord[],
  ): Promise<{
    implementationStatus:
      | 'completed'
      | 'partially_implemented'
      | 'not_implemented';
    evidence: EvidenceItem[];
  }> {
    const validChunks = chunks.filter(
      (c) => Array.isArray(c.embedding) && c.embedding.length > 0,
    );

    if (validChunks.length === 0) {
      return {
        implementationStatus: 'not_implemented',
        evidence: [],
      };
    }

    let topCandidates: Array<{ chunk: GithubCodeChunkRecord; score: number }> =
      [];

    try {
      const query = `${title}. ${description}`;
      const queryVector =
        await this.documentService.generateQueryEmbedding(query);

      const similarities =
        cosineSimilarity(
          [queryVector],
          validChunks.map((c) => c.embedding),
        )[0] ?? [];

      topCandidates = validChunks
        .map((chunk, index) => ({
          chunk,
          score: similarities[index] ?? 0,
        }))
        .filter((item) => item.score >= 0.22)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);
    } catch (err) {
      this.logger.warn(
        `Embedding comparison failed for requirement "${title}": ${err}`,
      );
    }

    if (topCandidates.length === 0) {
      return {
        implementationStatus: 'not_implemented',
        evidence: [],
      };
    }

    // Call LLM to confirm implementation and explain evidence
    const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
    if (!apiKey) {
      const best = topCandidates[0];
      return {
        implementationStatus:
          best.score > 0.65 ? 'completed' : 'partially_implemented',
        evidence: [
          {
            filePath: best.chunk.filePath,
            startLine: best.chunk.startLine,
            endLine: best.chunk.endLine,
            chunkId: best.chunk._id as unknown as Types.ObjectId,
            explanation: `Semantic match (${(best.score * 100).toFixed(0)}%) in ${best.chunk.filePath}`,
          },
        ],
      };
    }

    try {
      const chat = new ChatGoogleGenerativeAI({
        apiKey,
        model: process.env.PRIMARY_MODEL ?? 'gemini-2.5-flash',
        temperature: 0.1,
      });

      const snippetsText = topCandidates
        .map(
          (c, idx) =>
            `[SNIPPET ${idx}] File: ${c.chunk.filePath} (Lines ${c.chunk.startLine}-${c.chunk.endLine})
\`\`\`
${c.chunk.content.slice(0, 1500)}
\`\`\``,
        )
        .join('\n\n');

      const prompt = `You are a Principal Software Auditor verifying if a requirement is implemented in code from repository "${repoName}".

REQUIREMENT:
Title: "${title}"
Description: "${description}"

CODE SNIPPETS RETRIEVED FROM CODEBASE:
${snippetsText}

Instructions:
1. Examine the snippets carefully to see if the requirement logic, handler, schema, UI, or endpoint is implemented.
2. Determine implementationStatus strictly as one of:
   - "completed": Fully implemented.
   - "partially_implemented": Partially implemented or scaffolded.
   - "not_implemented": The snippets do not implement this requirement.
3. For snippets that provide evidence, provide the snippet index (0, 1, 2, etc.) and a concise 1-sentence explanation of what is implemented.

Return ONLY a valid JSON object matching this schema without markdown code blocks:
{
  "implementationStatus": "completed" | "partially_implemented" | "not_implemented",
  "evidence": [
    {
      "snippetIndex": 0,
      "explanation": "Concise explanation of how this code implements the requirement."
    }
  ]
}`;

      const response = await chat.invoke(prompt);
      let content =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);

      content = content.trim();
      if (content.startsWith('```')) {
        content = content.replace(/^```(?:json)?\s*/i, '');
        content = content.replace(/\s*```$/i, '');
      }

      const parsed = JSON.parse(content) as {
        implementationStatus?: string;
        evidence?: Array<{ snippetIndex: number; explanation: string }>;
      };

      const status =
        parsed.implementationStatus === 'completed' ||
        parsed.implementationStatus === 'partially_implemented' ||
        parsed.implementationStatus === 'not_implemented'
          ? parsed.implementationStatus
          : 'partially_implemented';

      const evidenceList: EvidenceItem[] = [];
      if (Array.isArray(parsed.evidence) && status !== 'not_implemented') {
        for (const ev of parsed.evidence) {
          const candidate = topCandidates[ev.snippetIndex];
          if (candidate) {
            evidenceList.push({
              filePath: candidate.chunk.filePath,
              startLine: candidate.chunk.startLine,
              endLine: candidate.chunk.endLine,
              chunkId: candidate.chunk._id as unknown as Types.ObjectId,
              explanation: ev.explanation || `Implements ${title}`,
            });
          }
        }
      }

      // If status is completed or partial but LLM didn't return evidence list, attach top candidate
      if (evidenceList.length === 0 && status !== 'not_implemented') {
        const best = topCandidates[0];
        evidenceList.push({
          filePath: best.chunk.filePath,
          startLine: best.chunk.startLine,
          endLine: best.chunk.endLine,
          chunkId: best.chunk._id as unknown as Types.ObjectId,
          explanation: `Relevant code in ${best.chunk.filePath}`,
        });
      }

      return {
        implementationStatus: status,
        evidence: evidenceList,
      };
    } catch (err) {
      this.logger.error(
        `LLM evaluation failed for requirement "${title}": ${err}`,
      );
      const best = topCandidates[0];
      return {
        implementationStatus:
          best.score > 0.65 ? 'completed' : 'partially_implemented',
        evidence: [
          {
            filePath: best.chunk.filePath,
            startLine: best.chunk.startLine,
            endLine: best.chunk.endLine,
            chunkId: best.chunk._id as unknown as Types.ObjectId,
            explanation: `Matched code snippet in ${best.chunk.filePath}`,
          },
        ],
      };
    }
  }

  private async callLlmToExtractRequirements(
    text: string,
    documentName: string,
  ): Promise<ExtractedRequirement[]> {
    const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
    const truncatedText = text.slice(0, 55000);

    const prompt = `You are a Principal Software Architect and Requirements Engineering Specialist.
Analyze the following requirement document and extract a comprehensive, well-organized list of software features and functional/technical requirements.

Instructions:
1. Identify all distinct features, capabilities, constraints, and business rules.
2. Provide a clear, actionable title and detailed description for each item.
3. Create consistent IDs: "REQ-01", "REQ-02", "REQ-03", etc.

DOCUMENT NAME: "${documentName}"
DOCUMENT CONTENT:
"""
${truncatedText}
"""

You MUST respond ONLY with a valid JSON array of objects. Do NOT include markdown code fences (like \`\`\`json), do NOT include greeting or summary text. Output ONLY the JSON array matching this format:
[
  {
    "id": "REQ-01",
    "title": "Short feature title",
    "description": "Comprehensive description of expected behavior and acceptance criteria."
  }
]`;

    if (!apiKey) {
      this.logger.warn(
        'GEMINI_API_KEY / GOOGLE_API_KEY not configured. Generating fallback baseline requirements.',
      );
      return this.generateFallbackRequirements(text, documentName);
    }

    try {
      const model = new ChatGoogleGenerativeAI({
        apiKey,
        model: process.env.PRIMARY_MODEL ?? 'gemini-2.5-flash',
        temperature: 0.1,
      });

      const response = await model.invoke(prompt);
      let content =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);

      content = content.trim();
      if (content.startsWith('```')) {
        content = content.replace(/^```(?:json)?\s*/i, '');
        content = content.replace(/\s*```$/i, '');
      }

      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed)) {
        throw new Error('LLM response was not an array');
      }

      return parsed.map((item, index) => ({
        id: item.id || `REQ-${String(index + 1).padStart(2, '0')}`,
        title: item.title || `Requirement ${index + 1}`,
        description: item.description || '',
        status: 'accepted',
      }));
    } catch (err) {
      this.logger.error(
        `Failed to parse LLM requirements response: ${err instanceof Error ? err.message : String(err)}`,
      );
      return this.generateFallbackRequirements(text, documentName);
    }
  }

  private generateFallbackRequirements(
    text: string,
    documentName: string,
  ): ExtractedRequirement[] {
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 20 && !l.startsWith('#'));

    const items: ExtractedRequirement[] = [];
    const limit = Math.min(lines.length, 6);

    for (let i = 0; i < limit; i++) {
      const line = lines[i];
      const title =
        line.length > 60 ? `${line.substring(0, 57)}...` : line;
      items.push({
        id: `REQ-${String(i + 1).padStart(2, '0')}`,
        title: `Requirement: ${title}`,
        description: line,
        status: 'accepted',
      });
    }

    if (items.length === 0) {
      items.push({
        id: 'REQ-01',
        title: 'Core System Functionality',
        description: `Implement primary software capabilities as specified in ${documentName}.`,
        status: 'accepted',
      });
    }

    return items;
  }
}
