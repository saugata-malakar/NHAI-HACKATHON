# FaceAuth Offline — NHAI Hackathon 7.0

This repository contains the complete, production-grade, enterprise-scale secure offline biometric facial recognition and liveness authentication system built for the NHAI Hackathon.

🌐 **Primary Production Web Dashboard**: [https://faceauth-web.vercel.app](https://faceauth-web.vercel.app)

---

## Repository Structure

The project is organized into two primary subdirectories:

1. **[FaceAuthOffline](file:///c:/Users/trina/Downloads/FaceAuthOffline_SourceCode/FaceAuthOffline)**: The React Native mobile application built for cross-functional deployment on Android (8.0+) and iOS (12+).
   * Supports **Locality Sensitive Hashing (LSH)** sub-linear lookups.
   * Features **Active and Passive Liveness Verification** with random eye-blink/smile/head-turn challenge responses.
   * Cryptographically links logins into an **AES-256-CBC Encrypted SQL Chained Ledger**.
   * Integrates background sync managers with certificate pinning, Sentry scrubbing, and operator inactivity timeouts.

2. **[FaceAuthWeb](file:///c:/Users/trina/Downloads/FaceAuthOffline_SourceCode/FaceAuthWeb)**: The static web application serving the enterprise admin diagnostic, ledger verification, and telemetry audit dashboard.
   * Provisioned and hosted live at **[https://faceauth-web.vercel.app](https://faceauth-web.vercel.app)**.
   * Displays circular logging telemetry charts, synchronization retry queues, and a comprehensive developer **Tamper Lab** to simulation/verify ledger security links.

---

## Getting Started

Refer to the individual readmes in the subdirectories for detailed environment settings, prerequisites, local execution commands, and cloud S3/DynamoDB event triggers.
