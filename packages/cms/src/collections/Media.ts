import type { CollectionConfig } from "payload/types";
import { afterMediaChange } from "../hooks/media";

const Media: CollectionConfig = {
  slug: "media",
  labels: {
    singular: "Media",
    plural: "Media",
  },
  hooks: {
    afterChange: [afterMediaChange],
  },
  access: {
    read: () => true,
  },
  admin: {
    useAsTitle: "filename",
  },
  upload: {
    mimeTypes: ["image/*", "application/pdf", "application/zip"],
    adminThumbnail: "thumbnail",
    imageSizes: [
      {
        name: "thumbnail",
        width: 250,
        height: 250,
      },
      {
        name: "medium",
        width: 768,
        height: 768,
      },
      {
        name: "large",
        width: 1920,
        height: null, // auto height for large
      },
      {
        name: "portrait",
        width: 320,
        height: 360,
      },
    ],
  },
  fields: [
    {
      name: "alt",
      label: "Alt Text",
      type: "text",
    },
    {
      name: "fileNameOverride",
      label: "File Name Override",
      type: "text",
    },
  ],
};

export default Media;
