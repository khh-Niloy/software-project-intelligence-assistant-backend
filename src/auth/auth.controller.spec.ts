import { Test, TestingModule } from '@nestjs/testing';
import { Response } from 'express';
import { Types } from 'mongoose';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { jwtConfig } from '../config/jwt.config';

describe('AuthController', () => {
  let controller: AuthController;
  let mockAuthService: any;

  const mockConfig = {
    accessSecret: 'test-secret',
    accessExpiresIn: '15m',
    refreshSecret: 'test-refresh-secret',
    refreshExpiresIn: '7d',
  };

  beforeEach(async () => {
    mockAuthService = {
      register: jest.fn(),
      login: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        {
          provide: jwtConfig.KEY,
          useValue: mockConfig,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('register', () => {
    it('should call authService.register and return success message and user', async () => {
      const dto = {
        name: 'Jane Doe',
        email: 'jane@example.com',
        password: 'password123',
        organizationId: new Types.ObjectId().toString(),
      };
      const createdUser = {
        _id: new Types.ObjectId(),
        ...dto,
        role: 'member' as const,
      };
      delete (createdUser as any).password;

      mockAuthService.register.mockResolvedValue(createdUser);

      const response = await controller.register(dto);
      expect(mockAuthService.register).toHaveBeenCalledWith(dto);
      expect(response.message).toBe('User registered successfully');
      expect(response.user).toEqual(createdUser);
    });
  });

  describe('login', () => {
    it('should call authService.login, set cookies and return user', async () => {
      const dto = { email: 'jane@example.com', password: 'password123' };
      const loginResult = {
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        user: {
          _id: new Types.ObjectId(),
          name: 'Jane Doe',
          email: 'jane@example.com',
          role: 'member' as const,
          organizationId: new Types.ObjectId(),
        },
      };

      mockAuthService.login.mockResolvedValue(loginResult);

      const mockResponse = {
        cookie: jest.fn(),
      } as unknown as Response;

      const response = await controller.login(dto, mockResponse);

      expect(mockAuthService.login).toHaveBeenCalledWith(dto);
      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'access_token',
        'access-123',
        expect.objectContaining({ httpOnly: true, path: '/' }),
      );
      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'refresh-456',
        expect.objectContaining({ httpOnly: true, path: '/' }),
      );
      expect(response.message).toBe('Login successful');
      expect(response.user).toEqual(loginResult.user);
    });
  });

  describe('logout', () => {
    it('should clear cookies and return logout message', async () => {
      const mockResponse = {
        clearCookie: jest.fn(),
      } as unknown as Response;

      const response = await controller.logout(mockResponse);

      expect(mockResponse.clearCookie).toHaveBeenCalledWith(
        'access_token',
        expect.objectContaining({ httpOnly: true, path: '/' }),
      );
      expect(mockResponse.clearCookie).toHaveBeenCalledWith(
        'refresh_token',
        expect.objectContaining({ httpOnly: true, path: '/' }),
      );
      expect(response.message).toBe('Logged out successfully');
    });
  });
});
