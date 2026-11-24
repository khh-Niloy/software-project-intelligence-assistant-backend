import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import type { SignOptions } from 'jsonwebtoken';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { User, UserSchema } from './schemas/user.schema';
import {
  Organization,
  OrganizationSchema,
} from './schemas/organization.schema';
import { jwtConfig, JwtConfig } from '../config/jwt.config';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Organization.name, schema: OrganizationSchema },
    ]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [jwtConfig.KEY],
      useFactory: (config: JwtConfig) => ({
        secret: config.accessSecret,
        signOptions: {
          expiresIn: config.accessExpiresIn as SignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard, RolesGuard],
  exports: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    PassportModule,
    JwtModule,
  ],
})
export class AuthModule {}
