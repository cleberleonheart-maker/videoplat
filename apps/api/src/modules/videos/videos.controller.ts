import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { VideosService } from './videos.service';
import { UpdateVideoDto } from './dto/video.dto';
import { Public } from '../../common/decorators/public.decorator';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videos: VideosService) {}

  @Public()
  @Get(':id')
  getById(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser | null,
  ) {
    return this.videos.getById(id, user?.id);
  }

  @Public()
  @Get(':id/playback')
  playback(@Param('id') id: string) {
    return this.videos.getPlayback(id);
  }

  @Public()
  @HttpCode(204)
  @Post(':id/views')
  async registerView(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser | null,
  ) {
    await this.videos.registerView(id, user?.id);
  }

  @ApiBearerAuth()
  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateVideoDto,
  ) {
    return this.videos.update(id, user.id, dto);
  }

  @ApiBearerAuth()
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.videos.remove(id, user.id);
  }

  @Public()
  @Get('channels/:handle/videos')
  listByChannel(
    @Param('handle') handle: string,
    @Query('limit') limit = '24',
    @Query('cursor') cursor?: string,
  ) {
    return this.videos.listByChannel(handle, Number(limit), cursor);
  }
}
