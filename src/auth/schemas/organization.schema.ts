import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OrganizationRecord = HydratedDocument<Organization>;

@Schema({ timestamps: true, collection: 'organizations' })
export class Organization {
  @Prop({ required: true, trim: true })
  name: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const OrganizationSchema = SchemaFactory.createForClass(Organization);
