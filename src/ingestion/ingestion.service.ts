import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as path from 'path';
import { Document as LangchainDocument } from '@langchain/core/documents';
import { Embeddings } from '@langchain/core/embeddings';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { OpenAIEmbeddings } from '@langchain/openai';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx';
import { CSVLoader } from '@langchain/community/document_loaders/fs/csv';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Document, DocumentRecord } from '../document/schemas/document.schema';
import {
  DocumentChunk,
  DocumentChunkRecord,
} from '../document/schemas/document-chunk.schema';
import { SupabaseService } from '../supabase/supabase.service';
import {
  GithubAccount,
  GithubAccountRecord,
} from '../github/schemas/github-account.schema';
import {
  GithubCodeChunk,
  GithubCodeChunkRecord,
} from '../github/schemas/github-code-chunk.schema';
import { IngestRepoDto } from '../github/dto/ingest-repo.dto';
import { CodeChunker, CodeChunkItem } from '../github/utils/code-chunker.util';

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private embeddingsInstance: Embeddings | null = null;

  constructor(
    @InjectModel(Document.name)
    private readonly documentModel: Model<DocumentRecord>,
    @InjectModel(DocumentChunk.name)
    private readonly documentChunkModel: Model<DocumentChunkRecord>,
    @InjectModel(GithubAccount.name)
    private readonly githubAccountModel: Model<GithubAccountRecord>,
    @InjectModel(GithubCodeChunk.name)
    private readonly githubCodeChunkModel: Model<GithubCodeChunkRecord>,
    private readonly supabaseService: SupabaseService,
  ) {}

  getEmbeddingsInstance(): Embeddings {
    if (this.embeddingsInstance) {
      return this.embeddingsInstance;
    }

    const googleApiKey =
      process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;

    if (googleApiKey) {
      const model = process.env.EMBEDDING_MODEL ?? 'gemini-embedding-001';
      this.logger.log(
        `Initializing GoogleGenerativeAIEmbeddings (${model})...`,
      );
      this.embeddingsInstance = new GoogleGenerativeAIEmbeddings({
        apiKey: googleApiKey,
        model,
      });
      return this.embeddingsInstance;
    }

    if (openaiApiKey) {
      this.logger.log(
        'Initializing OpenAIEmbeddings (text-embedding-3-small)...',
      );
      this.embeddingsInstance = new OpenAIEmbeddings({
        apiKey: openaiApiKey,
        model: process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small',
      });
      return this.embeddingsInstance;
    }

    throw new InternalServerErrorException(
      'Embedding API key is missing. Please set GOOGLE_API_KEY (or GEMINI_API_KEY) or OPENAI_API_KEY in your environment.',
    );
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    try {
      const embeddings = this.getEmbeddingsInstance();
      this.logger.log(`Generating embeddings for ${texts.length} chunk(s)...`);

      const vectors = await embeddings.embedDocuments(texts);
      this.logger.log(
        `Successfully generated ${vectors.length} vector embeddings (dimension: ${vectors[0]?.length ?? 0})`,
      );

      return vectors;
    } catch (error) {
      this.logger.error(
        'Failed to generate vector embeddings with LangChain Embeddings:',
        error instanceof Error ? error.stack : error,
      );
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Embedding generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async loadDocumentWithLangchain(
    buffer: Buffer,
    originalName: string,
  ): Promise<LangchainDocument[]> {
    const ext = path.extname(originalName).toLowerCase();
    const blob = new Blob([new Uint8Array(buffer)]);

    try {
      switch (ext) {
        case '.pdf': {
          const loader = new PDFLoader(blob, { splitPages: true });
          return await loader.load();
        }
        case '.docx': {
          const loader = new DocxLoader(blob);
          return await loader.load();
        }
        case '.csv': {
          const loader = new CSVLoader(blob);
          return await loader.load();
        }
        case '.txt':
        case '.md':
        case '.json': {
          const textContent = buffer.toString('utf-8');
          return [
            new LangchainDocument({
              pageContent: textContent,
              metadata: {
                source: originalName,
              },
            }),
          ];
        }
        default:
          throw new BadRequestException(
            `Unsupported file format "${ext}". Supported formats: .pdf, .docx, .csv, .txt, .md, .json`,
          );
      }
    } catch (error) {
      this.logger.error(
        `Failed to parse document "${originalName}" with LangChain loader:`,
        error instanceof Error ? error.stack : error,
      );
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        `Failed to load and parse document: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async createChunks(
    docs: LangchainDocument[],
    chunkSize = 1000,
    chunkOverlap = 200,
  ): Promise<LangchainDocument[]> {
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
    });

    const chunks = await textSplitter.splitDocuments(docs);
    this.logger.log(
      `Generated ${chunks.length} chunks from ${docs.length} document section(s) (chunkSize: ${chunkSize}, chunkOverlap: ${chunkOverlap})`,
    );
    return chunks;
  }

  /**
   * Document Ingestion Pipeline (POST /ingest/doc)
   */
  async ingestDocument(file: Express.Multer.File) {
    if (!file || !file.buffer) {
      throw new BadRequestException('File and file buffer are required');
    }

    this.logger.log(
      `Processing uploaded file: ${file.originalname} (${file.size} bytes)`,
    );

    // 1. Upload file buffer to Supabase and get accessible public URL
    const { fileUrl } = await this.supabaseService.uploadFile(file);

    // 2. Load document pages/content with LangChain Document Loaders from buffer
    const loadedDocs = await this.loadDocumentWithLangchain(
      file.buffer,
      file.originalname,
    );

    const originalText = loadedDocs
      .map((doc) => doc.pageContent)
      .join('\n\n')
      .trim();

    // 3. Create chunks using LangChain text splitter
    const chunks = await this.createChunks(loadedDocs);

    // 4. Generate vector embeddings for all chunk texts using LangChain Embeddings
    const chunkTexts = chunks.map((chunk) => chunk.pageContent);
    const embeddings = await this.generateEmbeddings(chunkTexts);

    // 5. Persist parent document record into MongoDB with Supabase fileUrl
    const savedDocument = await this.documentModel.create({
      filename: file.originalname,
      fileUrl,
      originalText,
      status: 'completed',
      totalChunks: chunks.length,
    });

    // 6. Create and persist document chunks with embeddings & structured metadata in MongoDB
    const fileExt = path
      .extname(file.originalname)
      .replace(/^\./, '')
      .toLowerCase();

    const chunkDocs = chunks.map((chunk, index) => {
      const rawPageNumber =
        (chunk.metadata?.loc as { pageNumber?: number } | undefined)
          ?.pageNumber ?? (chunk.metadata?.pageNumber as number | undefined);
      const pageNumber =
        typeof rawPageNumber === 'number' && rawPageNumber > 0
          ? rawPageNumber
          : 1;

      return {
        documentId: savedDocument._id,
        text: chunk.pageContent,
        embedding: embeddings[index] ?? [],
        metadata: {
          documentId: savedDocument._id,
          fileName: file.originalname,
          fileType: fileExt,
          fileUrl,
          chunkIndex: index,
          totalChunks: chunks.length,
          pageNumber,
          charCount: chunk.pageContent.length,
        },
      };
    });

    if (chunkDocs.length > 0) {
      await this.documentChunkModel.insertMany(chunkDocs);
    }

    this.logger.log(
      `Document "${savedDocument.filename}" saved with ID: ${savedDocument._id.toString()} | Chunks with metadata & embeddings saved: ${chunkDocs.length}`,
    );

    return {
      message:
        'File uploaded to Supabase, chunked, embedded, and stored successfully with metadata using LangChain',
      document: savedDocument,
      stats: {
        totalCharacters: originalText.length,
        loadedPagesOrSections: loadedDocs.length,
        totalChunks: chunks.length,
        embeddingDimension: embeddings[0]?.length ?? 0,
      },
    };
  }

  /**
   * Determines whether a file path from a repository tree should be included.
   * - Include: .ts, .js, .md, .json
   * - Exclude: node_modules, dist, .git, .env, lock files, binaries, generated files.
   */
  shouldIncludeTreeFile(filePath: string): boolean {
    const segments = filePath.split('/').filter(Boolean);
    if (segments.length === 0) return false;

    const fileName = segments[segments.length - 1];
    const lowerFileName = fileName.toLowerCase();

    // 1. Exclude restricted directories anywhere in path
    const excludedDirs = new Set([
      'node_modules',
      'dist',
      '.git',
      'build',
      '.next',
      'out',
      'coverage',
      '.cache',
      '.turbo',
      'generated',
      '__generated__',
      'vendor',
    ]);
    if (segments.some((seg) => excludedDirs.has(seg.toLowerCase()))) {
      return false;
    }

    // 2. Exclude .env files
    if (
      lowerFileName === '.env' ||
      lowerFileName.startsWith('.env.') ||
      segments.some((seg) => seg.toLowerCase() === '.env')
    ) {
      return false;
    }

    // 3. Exclude lock files
    const excludedLockFiles = new Set([
      'package-lock.json',
      'npm-shrinkwrap.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      'bun.lockb',
      'bun.lock',
      'composer.lock',
      'cargo.lock',
      'gemfile.lock',
      'poetry.lock',
    ]);
    if (
      excludedLockFiles.has(lowerFileName) ||
      lowerFileName.endsWith('-lock.json') ||
      lowerFileName.endsWith('.lock') ||
      lowerFileName.endsWith('.lock.json')
    ) {
      return false;
    }

    // 4. Exclude generated files and binary artifacts
    const excludedGeneratedSuffixes = [
      '.min.js',
      '.min.cjs',
      '.bundle.js',
      '.chunk.js',
      '.d.ts',
      '.d.ts.map',
      '.js.map',
      '.tsbuildinfo',
      '.wasm',
      '.bin',
      '.exe',
      '.dll',
      '.so',
      '.dylib',
    ];
    if (
      excludedGeneratedSuffixes.some((suffix) => lowerFileName.endsWith(suffix))
    ) {
      return false;
    }

    // 5. Include only .ts, .js, .md, .json
    const allowedExtensions = ['.ts', '.js', '.md', '.json'];
    return allowedExtensions.some((ext) => lowerFileName.endsWith(ext));
  }

  /**
   * Repository Code-Aware Ingestion Pipeline (POST /ingest/repo)
   */
  async ingestRepository(dto: IngestRepoDto) {
    if (!dto?.repoName || !dto.repoName.trim()) {
      throw new BadRequestException('repoName is required');
    }

    const rawRepoInput = dto.repoName.trim();
    const repoName = rawRepoInput.includes('/')
      ? rawRepoInput.split('/').filter(Boolean).pop() || rawRepoInput
      : rawRepoInput;

    // Resolve owner and access token from stored GitHub account in database
    const account = await this.githubAccountModel
      .findOne()
      .sort({ updatedAt: -1 })
      .lean()
      .exec();

    if (!account?.username) {
      throw new BadRequestException(
        'No connected GitHub account found in database. Please connect your GitHub account first.',
      );
    }

    const owner = account.username;
    const branch = 'main';
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'LangChain-ToolCalling-RAG',
    };
    if (account.accessToken) {
      headers['Authorization'] = `Bearer ${account.accessToken}`;
    }

    // Step 1: Fetch repository tree directly from GitHub API
    const treeUrl = `https://api.github.com/repos/${encodeURIComponent(
      owner,
    )}/${encodeURIComponent(repoName)}/git/trees/${encodeURIComponent(
      branch,
    )}?recursive=1`;

    this.logger.log(
      `[Ingest] Fetching repository tree from GitHub API: ${owner}/${repoName}@${branch}`,
    );
    const treeRes = await fetch(treeUrl, { headers });

    if (!treeRes.ok) {
      const errBody = await treeRes.text();
      if (treeRes.status === 404) {
        throw new NotFoundException(
          `Repository or branch not found on GitHub: ${owner}/${repoName}@${branch}`,
        );
      }
      throw new BadRequestException(
        `Failed to fetch repository tree from GitHub API (HTTP ${treeRes.status}): ${errBody}`,
      );
    }

    const treeData = (await treeRes.json()) as {
      tree?: Array<{
        path: string;
        type: string;
      }>;
    };

    const eligibleFiles = (treeData.tree || []).filter(
      (item) =>
        (item.type === 'blob' || item.type === 'file') &&
        this.shouldIncludeTreeFile(item.path),
    );

    this.logger.log(
      `[Ingest] Found ${eligibleFiles.length} eligible source files in ${owner}/${repoName}@${branch}`,
    );

    // Step 2: Fetch each file's content from GitHub API and run code-aware chunking
    const allChunks: CodeChunkItem[] = [];
    const batchSize = 5;

    for (let i = 0; i < eligibleFiles.length; i += batchSize) {
      const fileBatch = eligibleFiles.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        fileBatch.map(async (fileItem) => {
          const cleanPath = fileItem.path.replace(/^\/+/, '');
          const contentUrl = `https://api.github.com/repos/${encodeURIComponent(
            owner,
          )}/${encodeURIComponent(
            repoName,
          )}/contents/${cleanPath}?ref=${encodeURIComponent(branch)}`;

          const fileRes = await fetch(contentUrl, { headers });
          if (!fileRes.ok) {
            this.logger.warn(
              `[Ingest] Skipping file "${cleanPath}" (HTTP ${fileRes.status})`,
            );
            return [];
          }

          const fileJson = (await fileRes.json()) as {
            type?: string;
            encoding?: string;
            content?: string;
          };

          if (
            fileJson.type !== 'file' ||
            fileJson.encoding !== 'base64' ||
            !fileJson.content
          ) {
            return [];
          }

          const rawText = Buffer.from(fileJson.content, 'base64').toString(
            'utf-8',
          );
          if (!rawText.trim()) {
            return [];
          }

          const language = CodeChunker.detectLanguage(cleanPath);
          return CodeChunker.chunkFileContent({
            repoName,
            filePath: cleanPath,
            language,
            content: rawText,
          });
        }),
      );

      for (const fileChunks of batchResults) {
        allChunks.push(...fileChunks);
      }
    }

    this.logger.log(
      `[Ingest] Generated ${allChunks.length} code-aware chunks across ${eligibleFiles.length} files`,
    );

    if (allChunks.length === 0) {
      return {
        repoName,
        owner,
        branch,
        totalFiles: eligibleFiles.length,
        totalChunks: 0,
        chunks: [],
      };
    }

    // Step 3: Generate vector embeddings using LangChain Embeddings in batches
    const embeddingBatchSize = 25;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < allChunks.length; i += embeddingBatchSize) {
      const slice = allChunks.slice(i, i + embeddingBatchSize);
      const textsToEmbed = slice.map((c) => c.content);
      const batchVectors = await this.generateEmbeddings(textsToEmbed);
      allEmbeddings.push(...batchVectors);
    }

    const chunksWithEmbeddings = allChunks.map((chunk, idx) => ({
      repoName: chunk.repoName,
      filePath: chunk.filePath,
      language: chunk.language,
      className: chunk.className,
      functionName: chunk.functionName,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      content: chunk.content,
      embedding: allEmbeddings[idx] ?? [],
    }));

    // Step 4: Persist to MongoDB
    await this.githubCodeChunkModel.deleteMany({ repoName });
    await this.githubCodeChunkModel.insertMany(chunksWithEmbeddings);
    this.logger.log(
      `[Ingest] Stored ${chunksWithEmbeddings.length} embedded code chunks in MongoDB for repo "${repoName}"`,
    );

    return {
      repoName,
      owner,
      branch,
      totalFiles: eligibleFiles.length,
      totalChunks: chunksWithEmbeddings.length,
      chunks: chunksWithEmbeddings,
    };
  }
}
