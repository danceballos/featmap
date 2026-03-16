import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FeatmapClient } from "../client.js";

export function registerPlanningTools(server: McpServer, client: FeatmapClient): void {
  server.registerTool(
    "create_feature",
    {
      description:
        "Create a new feature in the story map. You must supply the subWorkflowId and milestoneId " +
        "where the feature should appear. Use get_features first to discover valid IDs.",
      inputSchema: z.object({
        projectId: z.string().describe("The project UUID"),
        title: z.string().describe("Feature title"),
        subWorkflowId: z
          .string()
          .describe("The subWorkflow UUID that defines the row in the story map"),
        milestoneId: z
          .string()
          .describe("The milestone UUID that defines the column in the story map"),
      }),
    },
    async ({ projectId, title, subWorkflowId, milestoneId }) => {
      const feature = await client.createFeature(projectId, {
        subWorkflowId,
        milestoneId,
        title,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(feature, null, 2) }],
      };
    }
  );

  server.registerTool(
    "update_feature_description",
    {
      description:
        "Edit the description of an existing feature. Supports markdown. " +
        "Use this to add acceptance criteria, context, or design details.",
      inputSchema: z.object({
        featureId: z.string().describe("The feature UUID to update"),
        description: z.string().describe("New description content (markdown supported)"),
      }),
    },
    async ({ featureId, description }) => {
      const feature = await client.updateDescription(featureId, description);
      return {
        content: [{ type: "text", text: JSON.stringify(feature, null, 2) }],
      };
    }
  );

  server.registerTool(
    "move_feature",
    {
      description:
        "Move a feature to a different milestone or subWorkflow. " +
        "Use get_features to discover valid milestone and subWorkflow IDs before moving.",
      inputSchema: z.object({
        featureId: z.string().describe("The feature UUID to move"),
        toMilestoneId: z
          .string()
          .describe("Target milestone UUID (column in the story map)"),
        toSubWorkflowId: z
          .string()
          .describe("Target subWorkflow UUID (row in the story map)"),
        index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Position within the target slot, 0-based. Defaults to 0."),
      }),
    },
    async ({ featureId, toMilestoneId, toSubWorkflowId, index }) => {
      const feature = await client.moveFeature(featureId, {
        toMilestoneId,
        toSubWorkflowId,
        index,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(feature, null, 2) }],
      };
    }
  );

  server.registerTool(
    "add_comment",
    {
      description:
        "Add a comment to a feature. Use this to leave context, questions, or decisions " +
        "that the development team will see when they look at the feature from Cursor.",
      inputSchema: z.object({
        featureId: z.string().describe("The feature UUID to comment on"),
        post: z.string().describe("Comment text"),
      }),
    },
    async ({ featureId, post }) => {
      const comment = await client.addComment(featureId, post);
      return {
        content: [{ type: "text", text: JSON.stringify(comment, null, 2) }],
      };
    }
  );
}
