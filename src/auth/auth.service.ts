import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import type { SignOptions } from 'jsonwebtoken';
import { jwtConfig } from '../config/jwt.config';
import type { JwtConfig } from '../config/jwt.config';
import { User, UserRecord } from './schemas/user.schema';
import {
  Organization,
  OrganizationRecord,
} from './schemas/organization.schema';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import {
  JwtPayload,
  RefreshTokenPayload,
} from './interfaces/jwt-payload.interface';

export interface SafeUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
  role: 'admin' | 'member';
  organizationId: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: SafeUser;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserRecord>,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<OrganizationRecord>,
    private readonly jwtService: JwtService,
    @Inject(jwtConfig.KEY)
    private readonly config: JwtConfig,
  ) {}

  /**
   * Register a new user
   */
  async register(dto: RegisterDto): Promise<SafeUser> {
    if (!dto) {
      throw new BadRequestException('Request body is required');
    }

    const { name, email, password, organizationId } = dto;

    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new BadRequestException('Name is required');
    }

    if (!email || typeof email !== 'string' || !email.trim()) {
      throw new BadRequestException('Email is required');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      throw new BadRequestException('Invalid email format');
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      throw new BadRequestException(
        'Password is required and must be at least 6 characters long',
      );
    }

    if (!organizationId || typeof organizationId !== 'string') {
      throw new BadRequestException('Organization ID is required');
    }

    if (!Types.ObjectId.isValid(organizationId)) {
      throw new BadRequestException('Invalid organization ID format');
    }

    // Verify organization exists using existing Organization model
    const organization = await this.organizationModel
      .findById(organizationId)
      .exec();
    if (!organization) {
      throw new BadRequestException(
        `Organization with ID "${organizationId}" does not exist`,
      );
    }

    // Check if email already exists
    const existingUser = await this.userModel
      .findOne({ email: normalizedEmail })
      .exec();
    if (existingUser) {
      throw new ConflictException('A user with this email already exists');
    }

    // Hash password with bcrypt
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user with default role 'member' (never allow client to register as admin)
    const createdUser = await this.userModel.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: 'member',
      organizationId: new Types.ObjectId(organizationId),
    });

    return {
      _id: createdUser._id,
      name: createdUser.name,
      email: createdUser.email,
      role: createdUser.role,
      organizationId: createdUser.organizationId,
      createdAt: createdUser.createdAt,
      updatedAt: createdUser.updatedAt,
    };
  }

  /**
   * Login user and issue access and refresh tokens
   */
  async login(dto: LoginDto): Promise<LoginResult> {
    if (!dto) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { email, password } = dto;

    if (
      !email ||
      !password ||
      typeof email !== 'string' ||
      typeof password !== 'string'
    ) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Explicitly retrieve the password field despite select: false
    const user = await this.userModel
      .findOne({ email: normalizedEmail })
      .select('+password')
      .exec();

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Compare submitted password using bcrypt.compare
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate access token (short-lived)
    const accessPayload: JwtPayload = {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
      organizationId: user.organizationId.toString(),
    };

    const accessToken = this.jwtService.sign(accessPayload, {
      secret: this.config.accessSecret,
      expiresIn: this.config.accessExpiresIn as SignOptions['expiresIn'],
    });

    // Generate refresh token (longer-lived)
    const refreshPayload: RefreshTokenPayload = {
      sub: user._id.toString(),
    };

    const refreshToken = this.jwtService.sign(refreshPayload, {
      secret: this.config.refreshSecret,
      expiresIn: this.config.refreshExpiresIn as SignOptions['expiresIn'],
    });

    return {
      accessToken,
      refreshToken,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    };
  }
}
