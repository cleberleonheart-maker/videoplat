import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { PlaylistsService } from './playlists.service';
import { Public } from '../../common/decorators/public.decorator';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';

class CreatePlaylistDto {
  @IsString()
  @Length(1, 140)
  title: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string;
}

class AddVideoDto {
  @IsString()
  videoId: string;
}

@ApiTags('playlists')
@Controller('playlists')
export class PlaylistsController {
  constructor(private readonly playlists: PlaylistsService) {}

  @ApiBearerAuth()
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePlaylistDto) {
    return this.playlists.create(user.id, dto.title, dto.description);
  }

  @ApiBearerAuth()
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.playlists.list(user.id);
  }

  @Public()
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser | null) {
    return this.playlists.get(id, user?.id);
  }

  @ApiBearerAuth()
  @Post(':id/videos')
  addVideo(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: AddVideoDto,
  ) {
    return this.playlists.addVideo(id, user.id, dto.videoId);
  }

  @ApiBearerAuth()
  @Delete(':id/videos/:videoId')
  removeVideo(
    @Param('id') id: string,
    @Param('videoId') videoId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.playlists.removeVideo(id, user.id, videoId);
  }
}
