import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { User } from './schemas/user.schema';
import { Organization } from './schemas/organization.schema';
import { jwtConfig } from '../config/jwt.config';

describe('AuthService', () => {
  let service: AuthService;
  let mockUserModel: any;
  let mockOrganizationModel: any;
  let mockJwtService: any;

  const mockConfig = {
    accessSecret: 'test-access-secret',
    accessExpiresIn: '15m',
    refreshSecret: 'test-refresh-secret',
    refreshExpiresIn: '7d',
  };

  beforeEach(async () => {
    mockUserModel = {
      findOne: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
    };

    mockOrganizationModel = {
      findById: jest.fn(),
    };

    mockJwtService = {
      sign: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getModelToken(User.name),
          useValue: mockUserModel,
        },
        {
          provide: getModelToken(Organization.name),
          useValue: mockOrganizationModel,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: jwtConfig.KEY,
          useValue: mockConfig,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    const validOrgId = new Types.ObjectId().toString();

    it('should throw BadRequestException if name is missing', async () => {
      await expect(
        service.register({
          name: '',
          email: 'test@example.com',
          password: 'password123',
          organizationId: validOrgId,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if email format is invalid', async () => {
      await expect(
        service.register({
          name: 'Test User',
          email: 'invalid-email',
          password: 'password123',
          organizationId: validOrgId,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if password is under 6 chars', async () => {
      await expect(
        service.register({
          name: 'Test User',
          email: 'test@example.com',
          password: '123',
          organizationId: validOrgId,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if organizationId format is invalid', async () => {
      await expect(
        service.register({
          name: 'Test User',
          email: 'test@example.com',
          password: 'password123',
          organizationId: 'not-an-objectid',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if organization does not exist', async () => {
      mockOrganizationModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(
        service.register({
          name: 'Test User',
          email: 'test@example.com',
          password: 'password123',
          organizationId: validOrgId,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException if user email already exists', async () => {
      mockOrganizationModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: validOrgId, name: 'Acme' }),
      });
      mockUserModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ email: 'test@example.com' }),
      });

      await expect(
        service.register({
          name: 'Test User',
          email: 'test@example.com',
          password: 'password123',
          organizationId: validOrgId,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should successfully register user as member and hash password', async () => {
      mockOrganizationModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: validOrgId, name: 'Acme' }),
      });
      mockUserModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      const fakeCreatedUser = {
        _id: new Types.ObjectId(),
        name: 'Test User',
        email: 'test@example.com',
        role: 'member',
        organizationId: new Types.ObjectId(validOrgId),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockUserModel.create.mockResolvedValue(fakeCreatedUser);

      const result = await service.register({
        name: '  Test User  ',
        email: 'TEST@EXAMPLE.COM',
        password: 'password123',
        organizationId: validOrgId,
      });

      expect(mockUserModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test User',
          email: 'test@example.com',
          role: 'member',
          organizationId: expect.any(Types.ObjectId),
        }),
      );
      expect(result.email).toBe('test@example.com');
      expect(result.role).toBe('member');
      expect((result as any).password).toBeUndefined();
    });
  });

  describe('login', () => {
    it('should throw UnauthorizedException if user not found', async () => {
      mockUserModel.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

      await expect(
        service.login({
          email: 'unknown@example.com',
          password: 'password123',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if password does not match', async () => {
      const hashedPassword = await bcrypt.hash('correctPassword', 10);
      mockUserModel.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: new Types.ObjectId(),
            email: 'user@example.com',
            password: hashedPassword,
          }),
        }),
      });

      await expect(
        service.login({ email: 'user@example.com', password: 'wrongPassword' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return tokens and user on successful login', async () => {
      const hashedPassword = await bcrypt.hash('secret123', 10);
      const userId = new Types.ObjectId();
      const orgId = new Types.ObjectId();

      mockUserModel.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: userId,
            name: 'John Doe',
            email: 'john@example.com',
            password: hashedPassword,
            role: 'member',
            organizationId: orgId,
          }),
        }),
      });

      mockJwtService.sign
        .mockReturnValueOnce('mock-access-token')
        .mockReturnValueOnce('mock-refresh-token');

      const result = await service.login({
        email: 'john@example.com',
        password: 'secret123',
      });

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBe('mock-refresh-token');
      expect(result.user.email).toBe('john@example.com');
      expect((result.user as any).password).toBeUndefined();
    });
  });
});
