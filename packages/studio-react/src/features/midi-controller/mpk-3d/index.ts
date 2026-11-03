import { lazy } from 'react';

/** Experimental 3D controller view; flip to false to hide the 2D/3D toggle. */
export const MPK_3D_ENABLED = true;

/** Code-split: three.js is only downloaded when the 3D view is first shown. */
export const LazyMpk3DView = lazy(() => import('./Mpk3DView'));
