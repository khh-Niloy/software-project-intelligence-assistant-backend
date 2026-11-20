import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type GithubCodeChunkRecord = HydratedDocument<GithubCodeChunk>;

@Schema({ timestamps: true, collection: 'github_code_chunks' })
export class GithubCodeChunk {
  @Prop({ required: true, index: true })
  repoName: string;

  @Prop({ required: true })
  filePath: string;

  @Prop({ required: true })
  language: string;

  @Prop({ type: String, default: '' })
  className: string;

  @Prop({ type: String, default: '' })
  functionName: string;

  @Prop({ required: true })
  startLine: number;

  @Prop({ required: true })
  endLine: number;

  @Prop({ required: true })
  content: string;

  @Prop({ type: [Number], required: true })
  embedding: number[];

  createdAt?: Date;
  updatedAt?: Date;
}

export const GithubCodeChunkSchema =
  SchemaFactory.createForClass(GithubCodeChunk);
