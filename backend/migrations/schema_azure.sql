-- ============================================================
-- Trade Marketing App — Optimized Schema for Azure SQL
-- ============================================================

-- Zones
CREATE TABLE Zone (
    ZoneId INT IDENTITY(1,1) PRIMARY KEY,
    Name NVARCHAR(80) NOT NULL UNIQUE
);

-- Channels
CREATE TABLE Channel (
    ChannelId INT IDENTITY(1,1) PRIMARY KEY,
    Name NVARCHAR(80) NOT NULL UNIQUE,
    IsActive BIT NOT NULL DEFAULT 1,
    CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

CREATE TABLE SubChannel (
    SubChannelId INT IDENTITY(1,1) PRIMARY KEY,
    ChannelId INT NOT NULL REFERENCES Channel(ChannelId),
    Name NVARCHAR(80) NOT NULL,
    IsActive BIT NOT NULL DEFAULT 1,
    CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
CREATE INDEX IX_SubChannel_ChannelId ON SubChannel(ChannelId);

-- Distributors
CREATE TABLE Distributor (
    DistributorId INT IDENTITY(1,1) PRIMARY KEY,
    Name NVARCHAR(160) NOT NULL UNIQUE,
    IsActive BIT NOT NULL DEFAULT 1
);

-- Roles & Users
CREATE TABLE Role (
    RoleId INT IDENTITY(1,1) PRIMARY KEY,
    Name NVARCHAR(40) NOT NULL UNIQUE
);

CREATE TABLE [User] (
    UserId INT IDENTITY(1,1) PRIMARY KEY,
    Email NVARCHAR(120) NOT NULL UNIQUE,
    PasswordHash NVARCHAR(200),
    DisplayName NVARCHAR(120) NOT NULL,
    ZoneId INT REFERENCES Zone(ZoneId),
    IsActive BIT NOT NULL DEFAULT 1,
    CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    UpdatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
CREATE INDEX IX_User_ZoneId ON [User](ZoneId);
CREATE INDEX IX_User_Email ON [User](Email);

CREATE TABLE UserRole (
    UserId INT NOT NULL REFERENCES [User](UserId),
    RoleId INT NOT NULL REFERENCES Role(RoleId),
    PRIMARY KEY (UserId, RoleId)
);

-- PDV (Point of Sale)
CREATE TABLE PDV (
    PdvId INT IDENTITY(1,1) PRIMARY KEY,
    Code NVARCHAR(50) UNIQUE,
    Name NVARCHAR(160) NOT NULL,
    Channel NVARCHAR(40),
    ChannelId INT REFERENCES Channel(ChannelId),
    SubChannelId INT REFERENCES SubChannel(SubChannelId),
    Address NVARCHAR(200),
    City NVARCHAR(80),
    ZoneId INT REFERENCES Zone(ZoneId),
    DistributorId INT REFERENCES Distributor(DistributorId),
    Lat DECIMAL(9,6),
    Lon DECIMAL(9,6),
    ContactName NVARCHAR(120),
    ContactPhone NVARCHAR(40),
    DefaultMaterialExternalId NVARCHAR(50),
    IsActive BIT NOT NULL DEFAULT 1,
    CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    UpdatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
CREATE INDEX IX_PDV_ZoneId ON PDV(ZoneId);
CREATE INDEX IX_PDV_ChannelId ON PDV(ChannelId);
CREATE INDEX IX_PDV_IsActive ON PDV(IsActive);
CREATE INDEX IX_PDV_DistributorId ON PDV(DistributorId);

CREATE TABLE PdvContact (
    PdvContactId INT IDENTITY(1,1) PRIMARY KEY,
    PdvId INT NOT NULL REFERENCES PDV(PdvId),
    ContactName NVARCHAR(120) NOT NULL,
    ContactPhone NVARCHAR(40),
    ContactRole NVARCHAR(40),
    DecisionPower NVARCHAR(20),
    Birthday DATE,
    CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
CREATE INDEX IX_PdvContact_PdvId ON PdvContact(PdvId);

CREATE TABLE PdvDistributor (
    PdvDistributorId INT IDENTITY(1,1) PRIMARY KEY,
    PdvId INT NOT NULL REFERENCES PDV(PdvId),
    DistributorId INT NOT NULL REFERENCES Distributor(DistributorId)
);
CREATE INDEX IX_PdvDistributor_PdvId ON PdvDistributor(PdvId);

CREATE TABLE PdvAssignment (
    PdvId INT NOT NULL REFERENCES PDV(PdvId),
    UserId INT NOT NULL REFERENCES [User](UserId),
    AssignmentRole NVARCHAR(20) NOT NULL,
    StartsOn DATE NOT NULL,
    EndsOn DATE,
    PRIMARY KEY (PdvId, UserId, AssignmentRole, StartsOn)
);

-- Forms
CREATE TABLE Form (
    FormId INT IDENTITY(1,1) PRIMARY KEY,
    Name NVARCHAR(160) NOT NULL,
    Channel NVARCHAR(40),
    Version INT NOT NULL DEFAULT 1,
    IsActive BIT NOT NULL DEFAULT 1,
    CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

CREATE TABLE FormQuestion (
    QuestionId INT IDENTITY(1,1) PRIMARY KEY,
    FormId INT NOT NULL REFERENCES Form(FormId),
    Label NVARCHAR(400) NOT NULL,
    QType NVARCHAR(20) NOT NULL DEFAULT 'text',
    IsRequired BIT NOT NULL DEFAULT 0,
    SortOrder INT NOT NULL DEFAULT 0,
    RulesJson NVARCHAR(2000),
    DefaultValue NVARCHAR(400)
);
CREATE INDEX IX_FormQuestion_FormId ON FormQuestion(FormId);

CREATE TABLE FormOption (
    OptionId INT IDENTITY(1,1) PRIMARY KEY,
    QuestionId INT NOT NULL REFERENCES FormQuestion(QuestionId),
    Value NVARCHAR(200) NOT NULL,
    Label NVARCHAR(200) NOT NULL,
    SortOrder INT NOT NULL DEFAULT 0,
    ImageUrl NVARCHAR(500)
);
CREATE INDEX IX_FormOption_QuestionId ON FormOption(QuestionId);

-- Routes
CREATE TABLE Route (
    RouteId INT IDENTITY(1,1) PRIMARY KEY,
    Name NVARCHAR(120) NOT NULL,
    ZoneId INT REFERENCES Zone(ZoneId),
    FormId INT REFERENCES Form(FormId),
    IsActive BIT NOT NULL DEFAULT 1,
    CreatedByUserId INT REFERENCES [User](UserId),
    BejermanZone NVARCHAR(80),
    FrequencyType NVARCHAR(40),
    FrequencyConfig NVARCHAR(200),
    EstimatedMinutes INT,
    AssignedUserId INT REFERENCES [User](UserId),
    CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
CREATE INDEX IX_Route_AssignedUserId ON Route(AssignedUserId);
CREATE INDEX IX_Route_IsActive ON Route(IsActive);

CREATE TABLE RouteForm (
    RouteId INT NOT NULL REFERENCES Route(RouteId),
    FormId INT NOT NULL REFERENCES Form(FormId),
    SortOrder INT NOT NULL DEFAULT 0,
    PRIMARY KEY (RouteId, FormId)
);

CREATE TABLE RoutePdv (
    RouteId INT NOT NULL REFERENCES Route(RouteId),
    PdvId INT NOT NULL REFERENCES PDV(PdvId),
    SortOrder INT NOT NULL,
    Priority SMALLINT NOT NULL DEFAULT 3,
    PRIMARY KEY (RouteId, PdvId)
);
CREATE INDEX IX_RoutePdv_PdvId ON RoutePdv(PdvId);

CREATE TABLE RouteDay (
    RouteDayId INT IDENTITY(1,1) PRIMARY KEY,
    RouteId INT NOT NULL REFERENCES Route(RouteId),
    WorkDate DATE NOT NULL,
    AssignedUserId INT NOT NULL REFERENCES [User](UserId),
    Status NVARCHAR(20) NOT NULL DEFAULT 'PLANNED',
    CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
CREATE INDEX IX_RouteDay_WorkDate ON RouteDay(WorkDate);
CREATE INDEX IX_RouteDay_AssignedUserId ON RouteDay(AssignedUserId);
CREATE INDEX IX_RouteDay_RouteId ON RouteDay(RouteId);

CREATE TABLE RouteDayPdv (
    RouteDayId INT NOT NULL REFERENCES RouteDay(RouteDayId),
    PdvId INT NOT NULL REFERENCES PDV(PdvId),
    PlannedOrder INT NOT NULL,
    PlannedWindowFrom TIME,
    PlannedWindowTo TIME,
    Priority SMALLINT NOT NULL DEFAULT 3,
    ExecutionStatus NVARCHAR(20) NOT NULL DEFAULT 'PENDING',
    PRIMARY KEY (RouteDayId, PdvId)
);

-- Visits
CREATE TABLE Visit (
    VisitId INT IDENTITY(1,1) PRIMARY KEY,
    PdvId INT NOT NULL REFERENCES PDV(PdvId),
    UserId INT NOT NULL REFERENCES [User](UserId),
    RouteDayId INT REFERENCES RouteDay(RouteDayId),
    Status NVARCHAR(20) NOT NULL DEFAULT 'OPEN',
    OpenedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    ClosedAt DATETIMEOFFSET,
    FormId INT REFERENCES Form(FormId),
    FormVersion INT,
    FormStatus NVARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    SubmittedAt DATETIMEOFFSET,
    MaterialExternalId NVARCHAR(50),
    CloseReason NVARCHAR(200)
);
CREATE INDEX IX_Visit_PdvId ON Visit(PdvId);
CREATE INDEX IX_Visit_UserId ON Visit(UserId);
CREATE INDEX IX_Visit_OpenedAt ON Visit(OpenedAt);
CREATE INDEX IX_Visit_RouteDayId ON Visit(RouteDayId);
CREATE INDEX IX_Visit_Status ON Visit(Status);

CREATE TABLE VisitCheck (
    VisitCheckId INT IDENTITY(1,1) PRIMARY KEY,
    VisitId INT NOT NULL REFERENCES Visit(VisitId),
    CheckType NVARCHAR(10) NOT NULL,
    Ts DATETIMEOFFSET NOT NULL,
    Lat DECIMAL(9,6),
    Lon DECIMAL(9,6),
    AccuracyMeters DECIMAL(8,2),
    DistanceToPdvM DECIMAL(8,2),
    DeviceId INT
);
CREATE INDEX IX_VisitCheck_VisitId ON VisitCheck(VisitId);

CREATE TABLE VisitAnswer (
    AnswerId INT IDENTITY(1,1) PRIMARY KEY,
    VisitId INT NOT NULL REFERENCES Visit(VisitId),
    QuestionId INT NOT NULL REFERENCES FormQuestion(QuestionId),
    ValueText NVARCHAR(4000),
    ValueNumber DECIMAL(18,4),
    ValueBool BIT,
    OptionId INT REFERENCES FormOption(OptionId),
    ValueJson NVARCHAR(MAX),
    CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
CREATE INDEX IX_VisitAnswer_VisitId ON VisitAnswer(VisitId);

CREATE TABLE VisitPhoto (
    PhotoId INT IDENTITY(1,1) PRIMARY KEY,
    VisitId INT NOT NULL REFERENCES Visit(VisitId),
    Url NVARCHAR(500) NOT NULL,
    Caption NVARCHAR(200),
    CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
CREATE INDEX IX_VisitPhoto_VisitId ON VisitPhoto(VisitId);

CREATE TABLE VisitFormTime (
    VisitFormTimeId INT IDENTITY(1,1) PRIMARY KEY,
    VisitId INT NOT NULL REFERENCES Visit(VisitId),
    FormId INT NOT NULL REFERENCES Form(FormId),
    ElapsedSeconds INT NOT NULL DEFAULT 0,
    CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
CREATE INDEX IX_VisitFormTime_VisitId ON VisitFormTime(VisitId);

-- Visit Actions (Execution)
CREATE TABLE VisitAction (
    VisitActionId INT IDENTITY(1,1) PRIMARY KEY,
    VisitId INT NOT NULL REFERENCES Visit(VisitId),
    MandatoryActivityId INT,
    ActionType NVARCHAR(40) NOT NULL,
    Status NVARCHAR(20) NOT NULL DEFAULT 'PENDING',
    IsMandatory BIT NOT NULL DEFAULT 0,
    PhotoRequired BIT NOT NULL DEFAULT 0,
    PhotoTaken BIT NOT NULL DEFAULT 0,
    Description NVARCHAR(400),
    CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
CREATE INDEX IX_VisitAction_VisitId ON VisitAction(VisitId);

-- Mandatory Activities (Templates)
CREATE TABLE MandatoryActivity (
    MandatoryActivityId INT IDENTITY(1,1) PRIMARY KEY,
    Name NVARCHAR(200) NOT NULL,
    ActionType NVARCHAR(40) NOT NULL,
    Description NVARCHAR(400),
    DetailsJson NVARCHAR(MAX),
    PhotoRequired BIT NOT NULL DEFAULT 1,
    ChannelId INT REFERENCES Channel(ChannelId),
    RouteId INT REFERENCES Route(RouteId),
    IsActive BIT NOT NULL DEFAULT 1,
    CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

-- Market News
CREATE TABLE MarketNews (
    MarketNewsId INT IDENTITY(1,1) PRIMARY KEY,
    VisitId INT REFERENCES Visit(VisitId),
    PdvId INT REFERENCES PDV(PdvId),
    Tags NVARCHAR(200),
    Notes NVARCHAR(2000),
    CreatedBy INT REFERENCES [User](UserId),
    CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

-- Incidents
CREATE TABLE Incident (
    IncidentId INT IDENTITY(1,1) PRIMARY KEY,
    VisitId INT REFERENCES Visit(VisitId),
    PdvId INT REFERENCES PDV(PdvId),
    Type NVARCHAR(40) NOT NULL,
    Status NVARCHAR(20) NOT NULL DEFAULT 'OPEN',
    Priority INT NOT NULL DEFAULT 3,
    Notes NVARCHAR(2000),
    CreatedBy INT REFERENCES [User](UserId),
    CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
CREATE INDEX IX_Incident_PdvId ON Incident(PdvId);
CREATE INDEX IX_Incident_Status ON Incident(Status);

-- Notifications
CREATE TABLE Notification (
    NotificationId INT IDENTITY(1,1) PRIMARY KEY,
    Title NVARCHAR(200) NOT NULL,
    Body NVARCHAR(2000),
    Type NVARCHAR(40) NOT NULL DEFAULT 'info',
    TargetUserId INT REFERENCES [User](UserId),
    TargetRole NVARCHAR(40),
    IsActive BIT NOT NULL DEFAULT 1,
    ExpiresAt DATETIMEOFFSET,
    CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

-- Devices & Sync
CREATE TABLE Device (
    DeviceId INT IDENTITY(1,1) PRIMARY KEY,
    UserId INT NOT NULL REFERENCES [User](UserId),
    DeviceUuid NVARCHAR(200) NOT NULL UNIQUE,
    Platform NVARCHAR(20),
    AppVersion NVARCHAR(20),
    LastSeenAt DATETIMEOFFSET
);

CREATE TABLE SyncLog (
    SyncLogId INT IDENTITY(1,1) PRIMARY KEY,
    DeviceId INT NOT NULL REFERENCES Device(DeviceId),
    Direction NVARCHAR(10) NOT NULL,
    RecordCount INT NOT NULL DEFAULT 0,
    Status NVARCHAR(20) NOT NULL DEFAULT 'OK',
    CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

CREATE TABLE DeviceState (
    DeviceStateId INT IDENTITY(1,1) PRIMARY KEY,
    DeviceId INT NOT NULL REFERENCES Device(DeviceId),
    StateKey NVARCHAR(100) NOT NULL,
    StateValue NVARCHAR(MAX),
    UpdatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

-- Files
CREATE TABLE [File] (
    FileId INT IDENTITY(1,1) PRIMARY KEY,
    OriginalName NVARCHAR(255) NOT NULL,
    StorageUrl NVARCHAR(500) NOT NULL,
    MimeType NVARCHAR(100),
    SizeBytes BIGINT,
    UploadedBy INT REFERENCES [User](UserId),
    CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

-- Audit
CREATE TABLE AuditEvent (
    AuditEventId INT IDENTITY(1,1) PRIMARY KEY,
    UserId INT REFERENCES [User](UserId),
    Action NVARCHAR(50) NOT NULL,
    EntityType NVARCHAR(50),
    EntityId INT,
    Details NVARCHAR(MAX),
    CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
CREATE INDEX IX_AuditEvent_UserId ON AuditEvent(UserId);
CREATE INDEX IX_AuditEvent_CreatedAt ON AuditEvent(CreatedAt);

-- KPI Snapshots
CREATE TABLE PdvKpiSnapshot (
    PdvKpiSnapshotId INT IDENTITY(1,1) PRIMARY KEY,
    PdvId INT NOT NULL REFERENCES PDV(PdvId),
    SnapshotDate DATE NOT NULL,
    Score INT,
    Coverage INT,
    Frequency INT,
    Gps INT,
    DataQuality INT,
    CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
CREATE INDEX IX_PdvKpiSnapshot_PdvId ON PdvKpiSnapshot(PdvId);
CREATE INDEX IX_PdvKpiSnapshot_Date ON PdvKpiSnapshot(SnapshotDate);
