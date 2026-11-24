import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserRecord = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  })
  email: string;

  @Prop({ required: true, select: false })
  password: string;

  @Prop({
    type: String,
    enum: ['admin', 'member'],
    default: 'member',
  })
  role: 'admin' | 'member';

  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
  })
  organizationId: Types.ObjectId;

  createdAt?: Date;
  updatedAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
