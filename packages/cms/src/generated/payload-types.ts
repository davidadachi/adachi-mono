/* tslint:disable */
/**
 * This file was automatically generated by Payload CMS.
 * DO NOT MODIFY IT BY HAND. Instead, modify your source Payload config,
 * and re-run `payload generate:types` to regenerate this file.
 */

export interface Config {}
/**
 * This interface was referenced by `Config`'s JSON-Schema
 * via the `definition` "cms-users".
 */
export interface CMSUser {
  id: string;
  email?: string;
  resetPasswordToken?: string;
  resetPasswordExpiration?: string;
  loginAttempts?: number;
  lockUntil?: string;
  createdAt: string;
  updatedAt: string;
}
/**
 * This interface was referenced by `Config`'s JSON-Schema
 * via the `definition` "media".
 */
export interface Media {
  id: string;
  alt?: string;
  url?: string;
  filename?: string;
  mimeType?: string;
  filesize?: number;
  width?: number;
  height?: number;
  sizes: {
    thumbnail: {
      url?: string;
      width?: number;
      height?: number;
      mimeType?: string;
      filesize?: number;
      filename?: string;
    };
    medium: {
      url?: string;
      width?: number;
      height?: number;
      mimeType?: string;
      filesize?: number;
      filename?: string;
    };
    large: {
      url?: string;
      width?: number;
      height?: number;
      mimeType?: string;
      filesize?: number;
      filename?: string;
    };
    portrait: {
      url?: string;
      width?: number;
      height?: number;
      mimeType?: string;
      filesize?: number;
      filename?: string;
    };
  };
  createdAt: string;
  updatedAt: string;
}
/**
 * This interface was referenced by `Config`'s JSON-Schema
 * via the `definition` "borrowers".
 */
export interface Borrower {
  id: string;
  name: string;
  logo?: string | Media;
  bio?: {
    [k: string]: unknown;
  }[];
  website?: string;
  twitter?: string;
  linkedin?: string;
  borrowerFinancials: {
    totalLoansOriginated?: number;
    currentLoansOutstanding?: number;
    aum?: number;
    pastOffChainDeals: {
      text: string;
      id?: string;
    }[];
    otherProducts: {
      text: string;
      id?: string;
    }[];
    projections?: string;
  };
  underwritingPerformance: {
    performanceDocument?: string | Media;
    underwritingDescription?: string;
    defaultRate?: number;
  };
  team: {
    description?: string;
    members: {
      name: string;
      position?: string;
      image?: string | Media;
      linkedin?: string;
      id?: string;
      blockName?: string;
      blockType: 'team-member';
    }[];
  };
  mediaLinks: {
    title: string;
    url: string;
    id?: string;
  }[];
  contactInfo?: {
    [k: string]: unknown;
  }[];
  documents: {
    title: string;
    subtitle?: string;
    file?: string | Media;
    id?: string;
    blockName?: string;
    blockType: 'document';
  }[];
  deals?: (string | Deal)[];
  createdAt: string;
  updatedAt: string;
}
/**
 * This interface was referenced by `Config`'s JSON-Schema
 * via the `definition` "deals".
 */
export interface Deal {
  id: string;
  name: string;
  category: string;
  borrower: string | Borrower;
  overview: string;
  defaultInterestRate?: number;
  highlights: {
    text: string;
    id?: string;
  }[];
  useOfFunds?: string;
  risks?: string;
  securitiesAndRecourse: {
    secured?: boolean;
    type?: string;
    description?: string;
    value?: number;
    recourse?: boolean;
    recourseDescription?: string;
    covenants?: string;
  };
  documents: {
    title: string;
    subtitle?: string;
    file?: string | Media;
    id?: string;
    blockName?: string;
    blockType: 'document';
  }[];
  createdAt: string;
  updatedAt: string;
}
