import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RepoQnaRecord = HydratedDocument<RepoQna>;

@Schema({ timestamps: true, collection: 'repo_qnas' })
export class RepoQna {
  @Prop({ required: true, index: true })
  repoName: string;

  @Prop({ required: true })
  question: string;

  @Prop({ required: true })
  answer: string;

  @Prop({ default: false })
  insufficientContext: boolean;

  @Prop({ type: [Object], default: [] })
  rawChunks: Array<Record<string, unknown>>;

  @Prop({ type: Object, default: {} })
  timings: {
    embeddingSeconds: number;
    vectorSearchSeconds: number;
    llmSeconds: number;
    /** @deprecated Use llmSeconds. Kept for existing API consumers. */
    geminiSeconds: number;
    totalSeconds: number;
  };

  createdAt?: Date;
  updatedAt?: Date;
}

export const RepoQnaSchema = SchemaFactory.createForClass(RepoQna);
