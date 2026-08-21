CREATE UNIQUE INDEX "slack_channel_workspace_name_unique" ON "slack_channels" USING btree ("workspace_id","name");
