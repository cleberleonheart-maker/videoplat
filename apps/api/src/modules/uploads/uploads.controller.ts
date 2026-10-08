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
import { UploadsService } from './uploads.service';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { StartUploadDto, CompleteUploadDto } from './dto/upload.dto';

@ApiTags('uploads')
@ApiBearerAuth()
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('initiate')
  initiate(@CurrentUser() user: AuthUser, @Body() dto: StartUploadDto) {
    return this.uploads.startUpload(user.id, dto);
  }

  @Post('complete')
  complete(@CurrentUser() user: AuthUser, @Body() dto: CompleteUploadDto) {
    return this.uploads.completeUpload(user.id, dto);
  }

  @Delete(':videoId/:uploadId')
  abort(
    @CurrentUser() user: AuthUser,
    @Param('videoId') videoId: string,
    @Param('uploadId') uploadId: string,
  ) {
    return this.uploads.abortUpload(user.id, videoId, uploadId);
  }

  @Get('stuck')
  stuck(@Query('minutes') minutes = '60') {
    return this.uploads.stuckUploadsOlderThan(Number(minutes));
  }
}
