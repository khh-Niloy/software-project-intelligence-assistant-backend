import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type TraceProjectRecord = HydratedDocument<TraceProject>;

@Schema({ _id: false })
export class TraceRequirementItem {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  description: string;

  @Prop({ default: 'accepted', enum: ['pending', 'accepted', 'rejected'] })
  status: string;
}

export const TraceRequirementItemSchema =
  SchemaFactory.createForClass(TraceRequirementItem);

@Schema({ timestamps: true })
export class TraceProject {
  @Prop({ required: true, default: 'Untitled Requirement Project' })
  projectName: string;

  @Prop({ default: null })
  documentId?: string;

  @Prop({ default: null })
  documentName?: string;

  @Prop({ required: true })
  repoName: string;

  @Prop({ default: null })
  repoOwner?: string;

  @Prop({ type: [TraceRequirementItemSchema], default: [] })
  requirements: TraceRequirementItem[];

  @Prop({
    default: 'approved',
    enum: ['draft', 'approved'],
  })
  status: string;

  @Prop({ default: Date.now })
  approvedAt: Date;
}

export const TraceProjectSchema = SchemaFactory.createForClass(TraceProject);
