import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Embeddings } from '@langchain/core/embeddings';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Document, DocumentRecord } from './schemas/document.schema';

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);
  private embeddingsInstance: Embeddings | null = null;

  constructor(
    @InjectModel(Document.name)
    private readonly documentModel: Model<DocumentRecord>,
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

  async generateQueryEmbedding(query: string): Promise<number[]> {
    if (!query || !query.trim()) {
      throw new BadRequestException('Query string is required for embedding');
    }

    const embeddings = this.getEmbeddingsInstance();
    return await embeddings.embedQuery(query);
  }

  async getAllDocuments() {
    return this.documentModel.find().sort({ createdAt: -1 }).exec();
  }

  async getDocumentById(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid document ID format: ${id}`);
    }

    const document = await this.documentModel.findById(id).exec();
    if (!document) {
      throw new NotFoundException(`Document with ID "${id}" not found`);
    }

    return document;
  }
}
