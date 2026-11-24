import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RequirementRecord = HydratedDocument<Requirement>;

@Schema({ _id: false })
export class SourceInfo {
  @Prop({ type: Types.ObjectId, ref: 'Document', default: null })
  documentId?: Types.ObjectId;

  @Prop({ default: '' })
  documentName?: string;

  @Prop({ default: 1 })
  pageNumber?: number;
}

export const SourceInfoSchema = SchemaFactory.createForClass(SourceInfo);

@Schema({ _id: false })
export class EvidenceItem {
  @Prop({ required: true })
  filePath: string;

  @Prop({ default: 0 })
  startLine: number;

  @Prop({ default: 0 })
  endLine: number;

  @Prop({ type: Types.ObjectId, ref: 'GithubCodeChunk', default: null })
  chunkId?: Types.ObjectId;

  @Prop({ default: '' })
  explanation: string;
}

export const EvidenceItemSchema = SchemaFactory.createForClass(EvidenceItem);

@Schema({ _id: false })
export class RepoInfo {
  @Prop({ default: '' })
  owner: string;

  @Prop({ required: true, index: true })
  name: string;

  @Prop({ default: 'main' })
  branch: string;

  @Prop({ default: '' })
  commitSha: string;
}

export const RepoInfoSchema = SchemaFactory.createForClass(RepoInfo);

@Schema({ timestamps: true, collection: 'requirements' })
export class Requirement {
  @Prop({ required: true })
  requirementSlug: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  description: string;

  @Prop({ type: SourceInfoSchema, default: () => ({}) })
  source: SourceInfo;

  @Prop({ type: [EvidenceItemSchema], default: [] })
  evidence: EvidenceItem[];

  @Prop({
    required: true,
    enum: ['completed', 'partially_implemented', 'not_implemented'],
    default: 'not_implemented',
  })
  implementationStatus: 'completed' | 'partially_implemented' | 'not_implemented';

  @Prop({ type: RepoInfoSchema, required: true })
  repository: RepoInfo;

  createdAt?: Date;
  updatedAt?: Date;
}

export const RequirementSchema = SchemaFactory.createForClass(Requirement);
