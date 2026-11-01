'use client';
import {useEffect} from 'react';
import {useRouter} from 'next/navigation';
export function Refresh(){const router=useRouter();useEffect(()=>{const timer=setInterval(()=>router.refresh(),15000);return ()=>clearInterval(timer);},[router]);return <span className="small muted">Updates every 15 seconds</span>;}
