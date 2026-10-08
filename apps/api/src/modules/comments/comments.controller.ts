import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ReactionType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { CommentsService } from './comments.service';
import { Public } from '../../common/decorators/public.decorator';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';

class CreateCommentDto {
  @IsString()
  @Length(1, 10_000)
  body: string;

  @IsOptional()
  @IsString()
  parentId?: string;
}

class ReactionDto {
  @IsEnum(ReactionType)
  type: ReactionType;
}

@ApiTags('comments')
@Controller('videos/:videoId/comments')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Public()
  @Get()
  list(
    @Param('videoId') videoId: string,
    @Query('limit') limit = '20',
    @Query('cursor') cursor?: string,
  ) {
    return this.comments.list(videoId, Number(limit), cursor);
  }

  @ApiBearerAuth()
  @Post()
  create(
    @Param('videoId') videoId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCommentDto,
  ) {
    return this.comments.create(videoId, user.id, dto.body, dto.parentId);
  }

  @ApiBearerAuth()
  @Delete(':commentId')
  remove(
    @Param('commentId') commentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.comments.remove(commentId, user.id);
  }

  @ApiBearerAuth()
  @Post('reaction')
  react(
    @Param('videoId') videoId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ReactionDto,
  ) {
    return this.comments.react(videoId, user.id, dto.type);
  }
}
